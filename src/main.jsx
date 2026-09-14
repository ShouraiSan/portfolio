import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowDown, ArrowUpRight, Mail, Menu, X } from 'lucide-react';
import './styles.css';

const projects = [
  {
    index: '01',
    title: '带上她的眼睛',
    type: '短片 / 导演・制片・策划',
    href: 'https://www.bilibili.com/video/BV1DepcztECP',
    image: 'https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1800&q=88',
  },
  {
    index: '02',
    title: '我的北海道记忆',
    type: '影像叙事 / 剪辑・调色',
    href: 'https://www.bilibili.com/video/BV1EnjXzqEna',
    image: 'https://images.unsplash.com/photo-1490806843957-31f4c9a91c65?auto=format&fit=crop&w=1800&q=88',
  },
  {
    index: '03',
    title: '新媒体视觉实验',
    type: '内容策划 / AIGC・视觉设计',
    href: '#contact',
    image: 'https://images.unsplash.com/photo-1531058020387-3be344556be6?auto=format&fit=crop&w=1800&q=88',
  },
];

const strengths = [
  ['01', '全流程创作', '从概念孵化、脚本策划到拍摄制作与后期宣发，让创意在同一条逻辑中完整落地。'],
  ['02', '导演型思维', '以叙事、节奏与情绪为核心组织视觉，在品牌目标与观众体验之间找到准确表达。'],
  ['03', 'AI 协同设计', '熟练使用 AIGC 加速概念探索、视觉预演与内容生产，将技术转化为创意杠杆。'],
  ['04', '制片执行力', '具备团队组建、预算控制与项目推进经验，持续实现按时交付和成本优化。'],
];

function App() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const reveal = () => document.querySelectorAll('.reveal').forEach((el) => {
      if (el.getBoundingClientRect().top < innerHeight * .88) el.classList.add('shown');
    });
    reveal(); addEventListener('scroll', reveal, { passive: true });
    return () => removeEventListener('scroll', reveal);
  }, []);

  return <main>
    <header className="nav shell">
      <a className="logo" href="#top">Kensym<span>®</span></a>
      <nav className={open ? 'navlinks open' : 'navlinks'}>
        <a href="#about" onClick={() => setOpen(false)}>关于</a>
        <a href="#work" onClick={() => setOpen(false)}>作品</a>
        <a href="#strengths" onClick={() => setOpen(false)}>能力</a>
      </nav>
      <a className="contact-link" href="#contact">联系我 <ArrowUpRight size={15}/></a>
      <button className="menu" onClick={() => setOpen(!open)} aria-label="菜单">{open ? <X/> : <Menu/>}</button>
    </header>

    <section className="hero" id="top">
      <video autoPlay muted loop playsInline poster="https://images.unsplash.com/photo-1485846234645-a62644f84728?auto=format&fit=crop&w=2000&q=85">
        <source src="https://cdn.coverr.co/videos/coverr-a-man-working-on-his-laptop-1575/1080p.mp4" type="video/mp4" />
      </video>
      <div className="hero-shade"/>
      <div className="hero-content shell">
        <p className="eyebrow">Visual · AI · Brand Designer</p>
        <h1>让想象<br/>成为<span>可见</span>。</h1>
        <div className="hero-bottom">
          <p>Kensym，专注影像叙事、视觉设计与 AI 创意工作流。<br/>在策略、审美与执行之间，构建完整的视觉表达。</p>
          <a href="#work" className="round-btn" aria-label="查看作品"><ArrowDown/></a>
        </div>
      </div>
      <div className="hero-index">PORTFOLIO / 2026</div>
    </section>

    <section className="about section shell" id="about">
      <div className="section-kicker reveal"><span>01</span> PROFILE / 关于我</div>
      <div className="about-grid">
        <div className="portrait reveal"><img src="/assets/resume-2.jpeg" alt="姜来"/><span>JIANG LAI</span></div>
        <div className="intro reveal">
          <h2>我用导演的视角思考，<br/>用设计与技术完成表达。</h2>
          <p>南京传媒学院广播电视编导专业，现任校融媒体中心摄制部部长。我是一名兼具导演思维与制片执行力的全流程创作者，擅长从创意策划到落地宣发的内容闭环，也持续探索 AIGC 在视觉设计中的真实价值。</p>
          <div className="meta"><a href="mailto:future0224@126.com">future0224@126.com</a><span>Nanjing, China</span></div>
        </div>
      </div>
      <div className="stats reveal">
        <div><strong>03</strong><span>执导 / 制片短片</span></div>
        <div><strong>10+</strong><span>独立发布视频</span></div>
        <div><strong>1W+</strong><span>累计内容播放</span></div>
        <div><strong>06</strong><span>专业软件与工具</span></div>
      </div>
    </section>

    <section className="work section" id="work">
      <div className="shell"><div className="section-kicker reveal"><span>02</span> SELECTED WORK / 精选项目</div><h2 className="display-title reveal">Selected<br/>Projects</h2></div>
      <div className="projects shell">
        {projects.map((p) => <a href={p.href} target={p.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="project reveal" key={p.title}>
          <img src={p.image} alt=""/><div className="project-overlay"/><span className="project-index">{p.index}</span>
          <div className="project-copy"><p>{p.type}</p><h3>{p.title}</h3></div><ArrowUpRight className="project-arrow"/>
        </a>)}
      </div>
    </section>

    <section className="strengths section shell" id="strengths">
      <div className="section-kicker reveal"><span>03</span> CAPABILITIES / 个人优势</div>
      <div className="strength-head reveal"><h2>从洞察到交付，<br/>保持同一种准确。</h2><p>DAVINCI RESOLVE · PREMIERE<br/>PHOTOSHOP · AIGC · 剪映</p></div>
      <div className="strength-grid">{strengths.map(([n,t,d]) => <article className="strength reveal" key={n}><span>{n}</span><h3>{t}</h3><p>{d}</p></article>)}</div>
    </section>

    <footer className="footer" id="contact"><div className="shell footer-inner">
      <p className="eyebrow">Have a project in mind?</p><h2>一起创造<br/><span>值得被看见的作品。</span></h2>
      <a className="mail" href="mailto:future0224@126.com"><Mail/> future0224@126.com <ArrowUpRight/></a>
      <div className="footer-bottom"><span>© 2026 JIANG LAI</span><span>VISUAL / AI / BRAND DESIGNER</span><a href="#top">BACK TO TOP ↑</a></div>
    </div></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
