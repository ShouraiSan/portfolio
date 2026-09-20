import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, RotateCcw, X } from 'lucide-react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const remotePhotoBase = 'https://kensym15.dpdns.org/photo';
const photoBase = (import.meta.env.VITE_PHOTO_API_BASE_URL || (import.meta.env.DEV ? '/photo' : remotePhotoBase)).replace(/\/$/, '');

function sourceSet(entries = []) {
  return entries.map(({ url, width }) => `${url} ${width}w`).join(', ');
}

function Picture({ photo, mode, onLoad, onError }) {
  const variants = photo.images?.[mode];
  if (!variants) return null;
  const fallback = variants.jpeg?.at(-1) || variants.webp?.at(-1) || variants.avif?.at(-1);
  const sizes = mode === 'thumbnail'
    ? '(max-width: 640px) 100vw, (max-width: 1100px) 50vw, 33vw'
    : '100vw';

  return <picture>
    {variants.avif?.length > 0 && <source type="image/avif" srcSet={sourceSet(variants.avif)} sizes={sizes}/>} 
    {variants.webp?.length > 0 && <source type="image/webp" srcSet={sourceSet(variants.webp)} sizes={sizes}/>} 
    <img
      src={fallback?.url}
      srcSet={sourceSet(variants.jpeg)}
      sizes={sizes}
      alt={photo.alt || photo.title}
      loading={mode === 'thumbnail' && photo.priority ? 'eager' : mode === 'thumbnail' ? 'lazy' : 'eager'}
      fetchPriority={mode === 'thumbnail' && photo.priority ? 'high' : 'auto'}
      draggable="false"
      onContextMenu={(event) => event.preventDefault()}
      onLoad={onLoad}
      onError={onError}
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
  const [status, setStatus] = useState(photo.pending ? 'pending' : 'loading');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => setStatus(photo.pending ? 'pending' : 'loading'), [photo.assetId, photo.pending]);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') onChange((current) => (current - 1 + photos.length) % photos.length);
      if (event.key === 'ArrowRight') onChange((current) => (current + 1) % photos.length);
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
  }, [onChange, onClose, photos.length, triggerRef]);

  useEffect(() => {
    if (status !== 'ready' || photos.length < 2) return;
    const neighbor = photos[(index + 1) % photos.length];
    const url = neighbor.images?.lightbox?.webp?.at(-1)?.url || neighbor.images?.lightbox?.jpeg?.at(-1)?.url;
    if (url) new Image().src = url;
  }, [index, photos, status]);

  const previous = () => onChange((current) => (current - 1 + photos.length) % photos.length);
  const next = () => onChange((current) => (current + 1) % photos.length);

  return <div ref={dialogRef} className="photo-lightbox" role="dialog" aria-modal="true" aria-label={`${photo.title} 图片查看器`} onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <div className="photo-lightbox-bar">
      <p aria-live="polite">{String(index + 1).padStart(2, '0')} / {String(photos.length).padStart(2, '0')}</p>
      <button ref={closeRef} type="button" onClick={onClose} aria-label="关闭灯箱" title="关闭"><X/></button>
    </div>
    <button className="photo-lightbox-nav photo-lightbox-prev" type="button" onClick={previous} aria-label="上一张" title="上一张"><ChevronLeft/></button>
    <div className="photo-lightbox-stage" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {!photo.pending && <Picture key={`${photo.assetId}-${retryKey}`} photo={photo} mode="lightbox" onLoad={() => setStatus('ready')} onError={() => setStatus('error')}/>} 
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

  const loadManifest = async () => {
    setLoadError(false);
    try {
      const response = await fetch(`${photoBase}/manifest`, { credentials: 'omit' });
      if (!response.ok) throw new Error(`Manifest request failed: ${response.status}`);
      setManifest(await response.json());
    } catch {
      setLoadError(true);
    }
  };

  useEffect(() => { loadManifest(); }, []);

  const visiblePhotos = useMemo(() => {
    const photos = manifest?.photos || [];
    return category === '全部' ? photos : photos.filter((photo) => photo.category === category);
  }, [category, manifest]);

  const openPhoto = (photo, button) => {
    triggerRef.current = button;
    setLightboxIndex(visiblePhotos.findIndex((item) => item.assetId === photo.assetId));
  };

  return <main className="photography-page">
    <header className="sub-nav photo-nav shell"><a className="logo" href="./">Kensym<span>®</span></a><a className="back-link" href="./"><ArrowLeft size={16}/> 返回首页</a></header>
    <section className="photo-heading shell" id="photo-top">
      <p className="photo-overline"><span>PHOTOGRAPHY</span><span>KENSYM® / 2026</span></p>
      <h1><span>摄</span><span>影</span><span className="photo-title-mark">。</span></h1>
      <p className="photo-lead">让光线、距离与偶然，<br/>停在一帧里。</p>
      <p className="photo-demo-label">{manifest?.demo ? 'DEMO CONTENT · 待替换' : manifest ? `ARCHIVE · ${String(manifest.photos.length).padStart(2, '0')} FRAMES` : 'LOADING ARCHIVE'}</p>
    </section>

    {manifest && <nav className="photo-filters" id="photo-archive" aria-label="摄影作品分类"><div ref={filterRef} className="shell photo-filter-inner" onPointerMove={moveFilters} onPointerLeave={resetFilterMotion}>
      <div className="photo-filter-options">
        {manifest.categories.map((item) => <button type="button" key={item} aria-pressed={category === item} onClick={() => { setCategory(item); setLightboxIndex(null); }}><span className="photo-filter-label">{item}</span></button>)}
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
              {photo.pending ? <PendingArtwork index={index}/> : <Picture photo={{ ...photo, priority: index < 3 }} mode="thumbnail"/>}
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
