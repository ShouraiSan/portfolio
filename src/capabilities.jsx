import React from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowUpRight, Mail } from 'lucide-react';
import './styles.css';

const practices = [
  ['01', '叙事与概念', '从受众、语境和品牌目标出发，找到作品最值得被记住的核心，再将它转化为可执行的视觉概念。', 'CONCEPT / SCRIPT / STORYBOARD'],
  ['02', '影像与视觉', '统筹画面、节奏、声音与色彩，让拍摄、设计和后期围绕同一个情绪方向工作。', 'DIRECTING / EDITING / COLOR'],
  ['03', 'AI 创意工作流', '将 AIGC 用于灵感发散、视觉预演与素材实验，保留人的判断，同时提高探索和交付效率。', 'RESEARCH / GENERATION / ITERATION'],
  ['04', '制片与落地', '拆解目标、组织协作、控制预算和进度，让创意从提案走向最终发布，并在限制中维持完成度。', 'TEAM / BUDGET / DELIVERY'],
];

function Capabilities() {
  return <main className="capability-page">
    <header className="sub-nav shell"><a className="logo" href="./">Kensym<span>®</span></a><a className="back-link" href="./"><ArrowLeft size={16}/> 返回首页</a></header>
    <section className="capability-hero shell">
      <p className="eyebrow">Capabilities · Creative Practice</p>
      <h1>不是工具清单，<br/><span>是一套完成作品的方法。</span></h1>
      <div className="capability-intro"><p>我在导演、设计与制片之间工作。对我而言，能力不是单一软件的熟练度，而是把模糊的想法变成清晰判断，再把判断推进为最终作品。</p><span>南京 / 影像 · 视觉 · AIGC</span></div>
    </section>
    <section className="practice-list shell">
      {practices.map(([n,title,description,tags]) => <article key={n}><span>{n}</span><h2>{title}</h2><p>{description}</p><small>{tags}</small></article>)}
    </section>
    <section className="tool-band"><div className="shell"><p>TOOLS / 工具体系</p><div>DaVinci Resolve <span>·</span> Premiere Pro <span>·</span> Photoshop <span>·</span> AIGC <span>·</span> 剪映</div></div></section>
    <footer className="capability-footer shell"><div><p className="eyebrow">Start a conversation</p><h2>让下一次合作，<br/>从一个好问题开始。</h2></div><a href="mailto:future0224@126.com"><Mail/> future0224@126.com <ArrowUpRight/></a></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<Capabilities/>);
