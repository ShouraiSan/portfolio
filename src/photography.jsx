import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// 注意：Image 必须别名导入 —— 本文件里用 new Image() 做图片预取，
// 若把 lucide 的 Image 直接引入会遮蔽全局构造函数。
import { ArrowLeft, ChevronLeft, ChevronRight, Download, Image as ImageIcon, Maximize2, Minimize2, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

// 摄影页的图片 API 入口。
// 注意：不要用 *.workers.dev 域名 —— 它在国内不可达（请求直接超时），
// 会导致页面能打开但照片全部加载失败。这里用 Worker 的自定义域名。
// 该域名同时是本 Worker 的必经路由，且已在 Worker 的 ALLOWED_ORIGINS 白名单内。
const remotePhotoBase = 'https://kensym15.dpdns.org/photo';
const photoBase = (import.meta.env.VITE_PHOTO_API_BASE_URL || (import.meta.env.DEV ? '/photo' : remotePhotoBase)).replace(/\/$/, '');

// 加载触发条件：图片露出视口 25% 时才开始下载。
// 不用 rootMargin 的提前量 —— 那会在图片还没划到时就预加载，
// 滚动较慢时能明显看出「人还没看到、图已经下完」。
// 也不用原生 loading="lazy"：它的预加载距离由浏览器决定（快速网络下常达 1250px+）。
const THUMB_VIEWPORT_THRESHOLD = 0.25;

function Picture({ photo, mode, onLoad, onError, stagger = 0 }) {
  const isThumbnail = mode === 'thumbnail';
  const [usingOriginalFallback, setUsingOriginalFallback] = useState(false);
  // 图片加载完成后才播放入场动画（配合 styles.css 的 photo-media-in）
  const [isLoaded, setIsLoaded] = useState(false);
  // 首屏的几张（priority）立即加载，其余等进入视口
  const [inView, setInView] = useState(() => !isThumbnail || Boolean(photo.priority));
  const frameRef = useRef(null);
  const thumbnailUrl = photo.thumbnail?.url;
  const originalUrl = photo.original?.url || photo.images?.[mode]?.jpeg?.at(-1)?.url;
  const url = isThumbnail && !usingOriginalFallback ? (thumbnailUrl || originalUrl) : originalUrl;
  useEffect(() => setUsingOriginalFallback(false), [photo.assetId, thumbnailUrl, mode]);
  // 图片源变化时重置，让回落原图或切换分类后能重新播放动画
  useEffect(() => setIsLoaded(false), [photo.assetId, url, mode]);
  // 切换分类后重置可见状态，重新按视口触发加载
  useEffect(() => {
    setInView(!isThumbnail || Boolean(photo.priority));
  }, [photo.assetId, isThumbnail, photo.priority]);

  // 观察自己是否已进入视口；一旦触发就固定为 true，不再回退（避免来回滚动反复请求）
  useEffect(() => {
    if (!isThumbnail || inView) return undefined;
    const node = frameRef.current;
    if (!node) return undefined;
    if (typeof IntersectionObserver === 'undefined') { setInView(true); return undefined; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setInView(true);
        observer.disconnect();
      }
    }, { threshold: THUMB_VIEWPORT_THRESHOLD });
    observer.observe(node);
    return () => observer.disconnect();
  }, [isThumbnail, inView, photo.assetId]);

  // 同一行的三张依次延迟 0 / 70 / 140ms，形成波浪感；封顶 3 避免长列表等待。
  // 只有网格缩略图播加入场动画，灯箱保持立即显示。
  const delayStep = Math.min(Math.max(stagger, 0), 3);
  const animate = isThumbnail;
  // 未进入视口时不设置 src，浏览器不会发起任何下载
  const activeUrl = inView ? url : undefined;

  return <picture ref={frameRef}>
    <img
      src={activeUrl}
      alt={photo.alt || photo.title}
      // src 由 IntersectionObserver 控制，这里固定 eager 即可（不设 src 时不会下载）
      loading="eager"
      fetchPriority={isThumbnail && photo.priority ? 'high' : 'auto'}
      draggable="false"
      className={animate && isLoaded ? 'is-loaded' : undefined}
      data-stagger={animate && delayStep > 0 ? '1' : undefined}
      style={animate && delayStep > 0 ? { animationDelay: `${delayStep * 70}ms` } : undefined}
      onContextMenu={(event) => event.preventDefault()}
      onLoad={(event) => {
        if (animate) setIsLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        if (isThumbnail && thumbnailUrl && !usingOriginalFallback && originalUrl) setUsingOriginalFallback(true);
        else onError?.(event);
      }}
    />
  </picture>;
}

function PendingArtwork({ index }) {
  return <div className="photo-pending" role="img" aria-label="图片待接入">
    <span>{String(index + 1).padStart(2, '0')}</span>
    <strong>IMAGE PENDING</strong>
    <small>R2 OBJECT / TO BE CONNECTED</small>
  </div>;
}

function Lightbox({ photos, index, onChange, onClose, triggerRef }) {
  const photo = photos[index];
  const closeRef = useRef(null);
  const dialogRef = useRef(null);
  const stageRef = useRef(null);
  const imageRef = useRef(null);
  const pointersRef = useRef(new Map());
  const gestureRef = useRef(null);
  const viewRef = useRef({ scale: 1, x: 0, y: 0 });
  const [status, setStatus] = useState(photo.pending ? 'pending' : 'loading');
  const [retryKey, setRetryKey] = useState(0);
  const [view, setView] = useState(viewRef.current);
  // 灯箱默认显示 2000px 预览图（约 220 KB，秒开），原图（约 13.5 MB，存在 R2）只在需要时再加载。
  // showOriginal 控制当前渲染哪一张；originalReady 表示原图已下载完成，可无闪烁切换。
  const [showOriginal, setShowOriginal] = useState(false);
  const [originalReady, setOriginalReady] = useState(false);

  const commitView = useCallback((next) => {
    const stage = stageRef.current;
    const image = imageRef.current;
    const scale = Math.min(4, Math.max(1, next.scale));
    let x = next.x;
    let y = next.y;
    if (stage && image) {
      const inset = matchMedia('(max-width: 700px)').matches ? 12 : 24;
      const fit = Math.min(1, (stage.clientWidth - inset) / image.naturalWidth, (stage.clientHeight - inset) / image.naturalHeight);
      const baseWidth = image.naturalWidth * fit;
      const baseHeight = image.naturalHeight * fit;
      const maxX = Math.max(0, (baseWidth * scale - stage.clientWidth) / 2);
      const maxY = Math.max(0, (baseHeight * scale - stage.clientHeight) / 2);
      x = Math.min(maxX, Math.max(-maxX, x));
      y = Math.min(maxY, Math.max(-maxY, y));
    }
    const normalized = { scale, x: scale === 1 ? 0 : x, y: scale === 1 ? 0 : y };
    viewRef.current = normalized;
    setView(normalized);
  }, []);

  const resetView = useCallback(() => commitView({ scale: 1, x: 0, y: 0 }), [commitView]);

  const zoomTo = useCallback((nextScale, clientX, clientY) => {
    const current = viewRef.current;
    const stage = stageRef.current;
    const scale = Math.min(4, Math.max(1, nextScale));
    if (!stage || scale === 1) return resetView();
    const rect = stage.getBoundingClientRect();
    const anchorX = (clientX ?? rect.left + rect.width / 2) - (rect.left + rect.width / 2);
    const anchorY = (clientY ?? rect.top + rect.height / 2) - (rect.top + rect.height / 2);
    const ratio = scale / current.scale;
    commitView({
      scale,
      x: anchorX - (anchorX - current.x) * ratio,
      y: anchorY - (anchorY - current.y) * ratio,
    });
  }, [commitView, resetView]);

  useEffect(() => {
    setStatus(photo.pending ? 'pending' : 'loading');
    imageRef.current = null;
    pointersRef.current.clear();
    gestureRef.current = null;
    resetView();
  }, [photo.assetId, photo.pending, resetView]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onChange((current) => (current - 1 + photos.length) % photos.length);
      if (event.key === 'ArrowRight') onChange((current) => (current + 1) % photos.length);
      if ((event.key === '+' || event.key === '=') && imageRef.current) zoomTo(viewRef.current.scale + .5);
      if (event.key === '-' && imageRef.current) zoomTo(viewRef.current.scale - .5);
      if (event.key === '0' && imageRef.current) resetView();
      if (event.key === 'Tab') {
        const controls = [...dialogRef.current.querySelectorAll('button:not([disabled])')];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
      triggerRef.current?.focus();
    };
  }, [onChange, onClose, photos.length, resetView, triggerRef, zoomTo]);

  useEffect(() => {
    const keepInBounds = () => commitView(viewRef.current);
    window.addEventListener('resize', keepInBounds);
    return () => window.removeEventListener('resize', keepInBounds);
  }, [commitView]);

  // 相邻图预取：只预取预览图（约 220 KB），不再预取 13.5 MB 的原图。
  // 原先预取原图会让「点开一张」实际下载约 27 MB，是流量的主要来源。
  useEffect(() => {
    if (status === 'pending' || photos.length < 2) return;
    const neighbor = photos[(index + 1) % photos.length];
    const url = neighbor.preview?.url;
    if (url) new Image().src = url;
  }, [index, photos, status]);

  // 预览图就绪后，在后台顺带把原图拉下来，这样点「查看原图」时能瞬间切换、不闪空白。
  // 原图来自 R2（出口流量不计费），但体积大，因此只在预览图已经显示之后才发起。
  useEffect(() => {
    setShowOriginal(false);
    setOriginalReady(false);
  }, [photo.assetId]);

  useEffect(() => {
    if (status !== 'ready' || showOriginal) return undefined;
    const url = photo.original?.url;
    if (!url) return undefined;
    let cancelled = false;
    const img = new Image();
    img.onload = () => { if (!cancelled) setOriginalReady(true); };
    img.src = url;
    return () => { cancelled = true; };
  }, [photo.assetId, photo.original?.url, status, showOriginal]);

  const previous = () => onChange((current) => (current - 1 + photos.length) % photos.length);
  const next = () => onChange((current) => (current + 1) % photos.length);

  const onWheel = (event) => {
    if (status !== 'ready') return;
    event.preventDefault();
    zoomTo(viewRef.current.scale * Math.exp(-event.deltaY * .0015), event.clientX, event.clientY);
  };

  const onPointerDown = (event) => {
    if (status !== 'ready') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...pointersRef.current.values()];
    if (pointers.length === 1) {
      gestureRef.current = { type: 'drag', startX: event.clientX, startY: event.clientY, ...viewRef.current };
    } else if (pointers.length === 2) {
      gestureRef.current = {
        type: 'pinch',
        distance: Math.hypot(pointers[1].x - pointers[0].x, pointers[1].y - pointers[0].y),
        midpointX: (pointers[0].x + pointers[1].x) / 2,
        midpointY: (pointers[0].y + pointers[1].y) / 2,
        ...viewRef.current,
      };
    }
  };

  const onPointerMove = (event) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pointers = [...pointersRef.current.values()];
    const gesture = gestureRef.current;
    if (pointers.length >= 2 && gesture?.type === 'pinch') {
      const distance = Math.hypot(pointers[1].x - pointers[0].x, pointers[1].y - pointers[0].y);
      const scale = Math.min(4, Math.max(1, gesture.scale * distance / Math.max(gesture.distance, 1)));
      const stage = stageRef.current?.getBoundingClientRect();
      const anchorX = gesture.midpointX - (stage?.left + stage?.width / 2 || gesture.midpointX);
      const anchorY = gesture.midpointY - (stage?.top + stage?.height / 2 || gesture.midpointY);
      const ratio = scale / gesture.scale;
      commitView({ scale, x: anchorX - (anchorX - gesture.x) * ratio, y: anchorY - (anchorY - gesture.y) * ratio });
    } else if (pointers.length === 1 && gesture?.type === 'drag' && gesture.scale > 1) {
      commitView({ scale: gesture.scale, x: gesture.x + event.clientX - gesture.startX, y: gesture.y + event.clientY - gesture.startY });
    }
  };

  const endPointer = (event) => {
    pointersRef.current.delete(event.pointerId);
    const remaining = [...pointersRef.current.values()];
    gestureRef.current = remaining.length === 1
      ? { type: 'drag', startX: remaining[0].x, startY: remaining[0].y, ...viewRef.current }
      : null;
  };

  return <div ref={dialogRef} className="photo-lightbox" role="dialog" aria-modal="true" aria-label={`${photo.title} 图片查看器`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="photo-lightbox-bar">
      <p aria-live="polite">{String(index + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}</p>
      <div className="photo-lightbox-actions" role="toolbar" aria-label="图片缩放控制">
        <button type="button" onClick={() => zoomTo(view.scale - .5)} disabled={status !== 'ready' || view.scale <= 1} aria-label="缩小图片" title="缩小"><Minus/></button>
        <output aria-live="polite" aria-label="当前缩放比例">{Math.round(view.scale * 100)}%</output>
        <button type="button" onClick={() => zoomTo(view.scale + .5)} disabled={status !== 'ready' || view.scale >= 4} aria-label="放大图片" title="放大"><Plus/></button>
        <button type="button" onClick={resetView} disabled={status !== 'ready' || view.scale === 1} aria-label="恢复适应窗口" title="适应窗口"><Maximize2/></button>
        {/* 预览图 → 原图切换。只在「显示的是预览图」且预览图已就绪时出现；
            原图已下载完成时按钮文案变为「显示原图」并直接切换，不再触发加载。 */}
        {!showOriginal && status === 'ready' && photo.original?.url && (
          <button type="button" onClick={() => setShowOriginal(true)} aria-label="查看原图" title="查看原图">
            {originalReady ? <><ImageIcon size={16}/><span className="photo-original-label">原图</span></> : <><Download size={16}/><span className="photo-original-label">查看原图</span></>}
          </button>
        )}
        {showOriginal && <button type="button" onClick={() => setShowOriginal(false)} aria-label="返回预览图" title="返回预览图"><Minimize2 size={16}/><span className="photo-original-label">预览</span></button>}
        <span aria-hidden="true"/>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭灯箱" title="关闭"><X/></button>
      </div>
    </div>
    <button className="photo-lightbox-nav photo-lightbox-prev" type="button" onClick={previous} aria-label="上一张" title="上一张"><ChevronLeft/></button>
    <div ref={stageRef} className={`photo-lightbox-stage${view.scale > 1 ? ' is-zoomed' : ''}`} onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endPointer} onPointerCancel={endPointer} onDoubleClick={(event) => zoomTo(view.scale > 1 ? 1 : 2, event.clientX, event.clientY)}>
      {!photo.pending && <div className="photo-zoom-surface" style={{ '--photo-scale': view.scale, '--photo-x': `${view.x}px`, '--photo-y': `${view.y}px` }}>
        <Picture key={`${photo.assetId}-${retryKey}-${showOriginal ? 'original' : 'preview'}`} photo={photo} mode={showOriginal ? 'lightbox' : 'preview'} onLoad={(event) => { imageRef.current = event.currentTarget; setStatus('ready'); resetView(); }} onError={() => setStatus('error')}/>
      </div>}
      {status === 'loading' && <div className="photo-image-state" role="status">LOADING IMAGE</div>}
      {status === 'pending' && <div className="photo-image-state photo-image-pending"><strong>IMAGE PENDING</strong><span>该 DEMO 记录尚未连接 R2 原图</span></div>}
      {status === 'error' && <div className="photo-image-state" role="alert"><span>图片加载失败</span><button type="button" onClick={() => { setStatus('loading'); setRetryKey((value) => value + 1); }}><RotateCcw size={16}/> 重试</button></div>}
    </div>
    <button className="photo-lightbox-nav photo-lightbox-next" type="button" onClick={next} aria-label="下一张" title="下一张"><ChevronRight/></button>
    <div className="photo-lightbox-info" onMouseDown={(event) => event.stopPropagation()}>
      <div><p>{photo.category} / {photo.year}</p><h2>{photo.title}</h2></div>
      <dl>
        {photo.camera && <><dt>CAMERA</dt><dd>{photo.camera}</dd></>}
        {photo.lens && <><dt>LENS</dt><dd>{photo.lens}</dd></>}
      </dl>
      {photo.description && <p className="photo-description">{photo.description}</p>}
    </div>
  </div>;
}

function Photography() {
  const [manifest, setManifest] = useState(null);
  const manifestRef = useRef(null);
  const [loadError, setLoadError] = useState(false);
  const [category, setCategory] = useState('全部');
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const triggerRef = useRef(null);
  const filterRef = useRef(null);
  const filterFrameRef = useRef(null);
  const closeLightbox = useCallback(() => setLightboxIndex(null), []);

  const resetFilterMotion = useCallback(() => {
    if (filterFrameRef.current) cancelAnimationFrame(filterFrameRef.current);
    filterRef.current?.querySelectorAll('button').forEach((button) => {
      button.style.removeProperty('--filter-scale');
      button.style.removeProperty('--filter-x');
      button.style.removeProperty('--filter-glow');
    });
  }, []);

  const moveFilters = useCallback((event) => {
    if (event.pointerType === 'touch' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pointerX = event.clientX;
    if (filterFrameRef.current) cancelAnimationFrame(filterFrameRef.current);
    filterFrameRef.current = requestAnimationFrame(() => {
      filterRef.current?.querySelectorAll('button').forEach((button) => {
        const rect = button.getBoundingClientRect();
        const deltaX = pointerX - (rect.left + rect.width / 2);
        const distance = Math.abs(deltaX);
        const influence = Math.exp(-(distance ** 2) / (2 * 108 ** 2));
        const magneticX = Math.max(-6, Math.min(6, deltaX * .065)) * influence;
        button.style.setProperty('--filter-scale', String(1 + influence * .22));
        button.style.setProperty('--filter-x', `${magneticX}px`);
        button.style.setProperty('--filter-glow', `${influence * 12}px`);
      });
    });
  }, []);

  useEffect(() => () => {
    if (filterFrameRef.current) cancelAnimationFrame(filterFrameRef.current);
  }, []);

  const loadManifest = useCallback(async () => {
    try {
      const response = await fetch(`${photoBase}/manifest`, { credentials: 'omit' });
      if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
      setManifest(await response.json());
      setLoadError(false);
    } catch {
      if (!manifestRef.current) setLoadError(true);
    }
  }, []);

  useEffect(() => { loadManifest(); }, [loadManifest]);

  manifestRef.current = manifest;
  useEffect(() => {
    if (!manifest?.expiresAt) return;
    const refresh = () => {
      if (document.visibilityState === 'visible' && Date.now() >= (manifestRef.current?.expiresAt - 60) * 1000) loadManifest();
    };
    const interval = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', refresh); };
  }, [manifest?.expiresAt, loadManifest]);

  const visiblePhotos = useMemo(() => {
    const photos = manifest?.photos || [];
    return category === '全部' ? photos : photos.filter((photo) => photo.category === category);
  }, [category, manifest]);

  const openPhoto = (photo, button) => {
    triggerRef.current = button;
    setLightboxIndex(visiblePhotos.findIndex((item) => item.assetId === photo.assetId));
  };

  const selectCategory = (item, button) => {
    resetFilterMotion();
    setCategory(item);
    setLightboxIndex(null);
    if (window.matchMedia('(max-width: 700px)').matches) {
      requestAnimationFrame(() => button.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' }));
    }
  };

  return <main className="photography-page">
    <header className="sub-nav photo-nav shell"><a className="logo" href="../">Kensym<span>®</span></a><a className="back-link" href="../"><ArrowLeft size={16}/> 返回首页</a></header>
    <section className="photo-heading shell" id="photo-top">
      <p className="photo-overline"><span>PHOTOGRAPHY</span><span>KENSYM® / 2026</span></p>
      <h1><span>摄</span><span>影</span><span className="photo-title-mark">。</span></h1>
      <p className="photo-lead">让光线、距离与偶然，<br/>停在一帧里。</p>
      <p className="photo-demo-label">{manifest?.demo ? 'DEMO CONTENT · 待替换' : manifest ? `ARCHIVE · ${String(manifest.photos.length).padStart(2, '0')} FRAMES` : 'LOADING ARCHIVE'}</p>
    </section>

    {manifest && <nav className="photo-filters" id="photo-archive" aria-label="摄影作品分类"><div ref={filterRef} className="shell photo-filter-inner" onPointerMove={moveFilters} onPointerLeave={resetFilterMotion}>
      <div className="photo-filter-options">
        {manifest.categories.map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={(event) => selectCategory(item, event.currentTarget)}><span className="photo-filter-label">{item}</span></button>)}
      </div>
      <span className="photo-filter-count">{String(visiblePhotos.length).padStart(2, '0')} FRAMES</span>
    </div></nav>}

    <section className="photo-gallery shell" aria-live="polite">
      {!manifest && !loadError && <div className="photo-page-state" role="status">LOADING ARCHIVE</div>}
      {loadError && <div className="photo-page-state"><strong>摄影清单暂时无法载入</strong><button type="button" onClick={loadManifest}><RotateCcw size={16}/> 重试</button></div>}
      {manifest && visiblePhotos.length === 0 && <div className="photo-page-state"><strong>这个分类暂时没有作品</strong><span>请选择其他分类继续浏览。</span></div>}
      {visiblePhotos.length > 0 && <div className="photo-grid" key={category}>
        {visiblePhotos.map((photo, index) => <article className="photo-card" key={photo.assetId} style={{ '--photo-ratio': `${photo.width} / ${photo.height}` }}>
          <button type="button" onClick={(event) => openPhoto(photo, event.currentTarget)} aria-label={`查看 ${photo.title}`}>
            <div className="photo-frame">
              {photo.pending ? <PendingArtwork index={index}/> : <Picture photo={{ ...photo, priority: index < 3 }} mode="thumbnail" stagger={index % 3}/>}
              <div className="photo-hover"><span>VIEW</span><strong>{photo.title}</strong><small>{photo.year}</small></div>
            </div>
            <div className="photo-mobile-meta"><div><span>{photo.title}</span><small>{photo.category}</small></div><small>{photo.year}</small></div>
          </button>
        </article>)}
      </div>}
    </section>

    <footer className="photo-footer shell"><span>KENSYM® / PHOTOGRAPHY</span><span>{manifest?.photos.length || '00'} FRAMES</span></footer>
    {lightboxIndex !== null && visiblePhotos[lightboxIndex] && <Lightbox photos={visiblePhotos} index={lightboxIndex} onChange={setLightboxIndex} onClose={closeLightbox} triggerRef={triggerRef}/>} 
  </main>;
}

createRoot(document.getElementById('root')).render(<Photography/>);
