
class Component extends DCLogic {
  constructor(props) {
    super(props);
    this.members = [
      { id:'u1', name:'张明', initials:'ZM', email:'zhangming@acme.io', role:'Owner', color:'#6e79d6', cap:8 },
      { id:'u2', name:'李婷', initials:'LT', email:'liting@acme.io', role:'Member', color:'#3f9d6b', cap:8 },
      { id:'u3', name:'王强', initials:'WQ', email:'wangqiang@acme.io', role:'Member', color:'#d6673f', cap:6 },
      { id:'u4', name:'赵磊', initials:'ZL', email:'zhaolei@acme.io', role:'Member', color:'#c74d8a', cap:8 },
      { id:'u5', name:'陈静', initials:'CJ', email:'chenjing@acme.io', role:'Member', color:'#4aa3c9', cap:6 }
    ];
    this.epics = [
      { id:'e1', name:'用户认证', color:'#6e79d6', quarter:'2026-Q3' },
      { id:'e2', name:'看板体验', color:'#3f9d6b', quarter:'2026-Q3' },
      { id:'e3', name:'报表分析', color:'#d1a03a', quarter:'2026-Q3' },
      { id:'e4', name:'通知系统', color:'#c74d8a', quarter:'2026-Q4' },
      { id:'e5', name:'性能优化', color:'#4aa3c9', quarter:'2026-Q4' },
      { id:'e6', name:'移动适配', color:'#d6673f', quarter:null }
    ];
    this.sprints = [
      { id:'s24', name:'Sprint 24', status:'ACTIVE', dates:'07-01 → 07-14' },
      { id:'s25', name:'Sprint 25', status:'PLANNED', dates:'07-15 → 07-28' },
      { id:'s23', name:'Sprint 23', status:'CLOSED', dates:'06-17 → 06-30' }
    ];
    const T = (id,type,title,status,points,a,e,sprint) => ({ id,type,title,status,points,assigneeId:a,epicId:e,sprintId:sprint });
    const tasks = [
      T('PM-101','STORY','登录支持第三方 OAuth','DONE',5,'u1','e1','s24'),
      T('PM-102','STORY','看板卡片虚拟滚动','IN_PROGRESS',3,'u2','e5','s24'),
      T('PM-103','BUG','拖拽到空列时卡片丢失','IN_PROGRESS',2,'u3','e2','s24'),
      T('PM-104','TASK','补充燃尽图数据接口','TODO',3,'u4','e3','s24'),
      T('PM-105','STORY','任务抽屉评论 Tab','COMPLETED',5,'u5','e2','s24'),
      T('PM-106','BUG','暗色下图表网格不可见','TODO',1,'u1','e3','s24'),
      T('PM-107','TASK','接入 PAT 鉴权中间件','DONE',2,'u2','e1','s24'),
      T('PM-108','STORY','容量条超载斜纹样式','COMPLETED',3,'u3','e2','s24'),
      T('PM-109','TASK','路线图季度分组渲染','TODO',2,'u4','e5','s24'),
      T('PM-110','BUG','邀请链接过期无提示','IN_PROGRESS',1,'u5','e1','s24'),
      T('PM-111','STORY','全局搜索占位交互','TODO',3,'u1','e2','s24'),
      T('PM-112','TASK','Toast 组件封装','COMPLETED',2,'u2','e4','s24'),
      T('PM-113','STORY','报表每人负载横条','IN_PROGRESS',5,'u3','e3','s24'),
      T('PM-114','BUG','移动端侧边栏溢出','DONE',2,'u4','e6','s24'),
      T('PM-115','TASK','Skeleton 加载态统一','DONE',3,'u5','e2','s24'),
      T('PM-116','STORY','Epic 颜色选择器','COMPLETED',3,'u2','e2','s23'),
      T('PM-117','BUG','关闭 Sprint 缺确认框','DONE',2,'u1','e2','s23'),
      T('PM-201','TASK','命令面板 Cmd+K','TODO',5,'u4','e2',null),
      T('PM-202','STORY','任务批量操作','TODO',8,'u3','e2',null),
      T('PM-203','TASK','键盘快捷键系统','TODO',3,'u5','e5',null),
      T('PM-204','STORY','邮件通知模板','TODO',5,null,'e4',null),
      T('PM-205','BUG','PAT 复制按钮无反馈','TODO',1,'u2','e1',null)
    ];
    this.state = {
      page:'board', dark:true, collapsed:false,
      drawerId:null, drawerTab:'comments',
      backlogFilter:'ALL', quickTitle:'', quickType:'STORY', quickPoints:3,
      tasks, hist:{}, comments:{}, commentDraft:'',
      toast:null, confirm:null, showAuth:false, authTab:'login',
      patToken:'', inviteLink:'', autoRotate:true,
      showEpicModal:false, epicName:'', epicColor:'#6e79d6', epicQuarter:'2026-Q3',
      projMenu:false, userMenu:false, loading:false,
      dragId:null, dragOverCol:null
    };
    this.STATUS = { TODO:'待办', IN_PROGRESS:'进行中', COMPLETED:'待验收', DONE:'已完成' };
    this.SVAR = { TODO:'todo', IN_PROGRESS:'prog', COMPLETED:'comp', DONE:'done' };
    this.TYPE = { STORY:'故事', BUG:'缺陷', TASK:'任务' };
  }

  svg(p, sw) { return { __html:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw||2}" stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%">${p}</svg>` }; }
  get ic() {
    return {
      dashboard:'<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
      backlog:'<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
      board:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M8 7v7"/><path d="M12 7v4"/><path d="M16 7v9"/>',
      sprints:'<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
      planning:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
      reports:'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M18 17V9"/><path d="M13 17V5"/><path d="M8 17v-3"/>',
      roadmap:'<path d="M14.1 5.55a2 2 0 0 0 1.79 0l3.66-1.83A1 1 0 0 1 21 4.62v12.76a1 1 0 0 1-.55.9l-4.55 2.27a2 2 0 0 1-1.79 0l-4.21-2.1a2 2 0 0 0-1.79 0l-3.66 1.82A1 1 0 0 1 3 19.38V6.62a1 1 0 0 1 .55-.9l4.55-2.27a2 2 0 0 1 1.79 0z"/><path d="M15 5.76v15"/><path d="M9 3.24v15"/>',
      admin:'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"/>',
      settings:'<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
      search:'<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
      chevron:'<path d="m6 9 6 6 6-6"/>',
      plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
      sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
      moon:'<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
      panel:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18"/>',
      x:'<path d="M18 6 6 18"/><path d="M6 6l12 12"/>',
      copy:'<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
      check:'<path d="M20 6 9 17l-5-5"/>',
      arrowRight:'<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
      refresh:'<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
      alert:'<path d="m21.73 18-8-14a2 2 0 0 0-3.46 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>'
    };
  }
  member(id){ return this.members.find(m=>m.id===id) || { initials:'—', name:'未分配', color:'#3a3d44' }; }
  epicOf(id){ return this.epics.find(e=>e.id===id) || null; }
  activeTasks(){ return this.state.tasks.filter(t=>t.sprintId==='s24'); }

  // ---- actions ----
  setPage = p => () => this.setState({ page:p, projMenu:false, userMenu:false, showAuth:false });
  goSettings = () => this.setState({ page:'settings', userMenu:false });
  toggleTheme = () => this.setState(s=>({ dark:!s.dark }));
  toggleCollapse = () => this.setState(s=>({ collapsed:!s.collapsed }));
  toggleProjMenu = () => this.setState(s=>({ projMenu:!s.projMenu, userMenu:false }));
  toggleUserMenu = () => this.setState(s=>({ userMenu:!s.userMenu, projMenu:false }));
  logout = () => this.setState({ showAuth:true, userMenu:false });
  enterApp = () => this.setState({ showAuth:false });
  authLogin = () => this.setState({ authTab:'login' });
  authRegister = () => this.setState({ authTab:'register' });
  openCreate = () => this.setState({ page:'backlog' }, ()=>this.showToast('在 Backlog 顶部快速创建','info'));
  stop = e => e && e.stopPropagation && e.stopPropagation();
  refresh = () => { this.setState({ loading:true }); clearTimeout(this._l); this._l=setTimeout(()=>this.setState({loading:false}),900); };

  showToast(msg, kind){ this.setState({ toast:{ msg, kind:kind||'success' } }); clearTimeout(this._t); this._t=setTimeout(()=>this.setState({toast:null}),2600); }
  openConfirm(cfg){ this.setState({ confirm:cfg }); }
  closeConfirm = () => this.setState({ confirm:null });
  doConfirm = () => { const c=this.state.confirm; this.setState({confirm:null}); if(c&&c.run) c.run(); };

  openDrawer = id => () => this.setState({ drawerId:id, drawerTab:'comments' });
  closeDrawer = () => this.setState({ drawerId:null });
  tabComments = () => this.setState({ drawerTab:'comments' });
  tabHistory = () => this.setState({ drawerTab:'history' });

  pushHist(id, text, mcp){ this.setState(s=>{ const h=(s.hist[id]||this.seedHist(id)).slice(); h.unshift({ who:'张明', text, time:'刚刚', mcp:!!mcp }); return { hist:{...s.hist,[id]:h} }; }); }
  seedHist(id){ return [
    { who:'系统', text:'把负责人指派给相关成员', time:'3 小时前', mcp:true },
    { who:'李婷', text:'把状态从 待办 改为 进行中', time:'昨天', mcp:false },
    { who:'张明', text:'创建了任务', time:'2 天前', mcp:false }
  ]; }
  seedComments(id){ return [
    { who:'王强', initials:'WQ', color:'#d6673f', text:'复现步骤：空列直接拖入时 index 越界。', time:'4 小时前' },
    { who:'李婷', initials:'LT', color:'#3f9d6b', text:'已定位，dnd-kit onDragEnd 未处理空容器，修复中。', time:'1 小时前' }
  ]; }

  moveTask(id, status){
    if(!id) return;
    const t=this.state.tasks.find(x=>x.id===id);
    if(!t || t.status===status) return;
    const from=this.STATUS[t.status], to=this.STATUS[status];
    this.setState(s=>({ tasks:s.tasks.map(x=>x.id===id?{...x,status}:x) }));
    this.pushHist(id, `把状态从 ${from} 改为 ${to}`);
    this.showToast(`${id} → ${to}`);
  }
  changeTask(id, field, value){
    const t=this.state.tasks.find(x=>x.id===id); if(!t) return;
    let label='';
    if(field==='status') label=`把状态改为 ${this.STATUS[value]}`;
    else if(field==='type') label=`把类型改为 ${this.TYPE[value]}`;
    else if(field==='points') label=`把估点改为 ${value}`;
    else if(field==='assigneeId') label=`把负责人改为 ${this.member(value).name}`;
    else if(field==='epicId') label=`把 Epic 改为 ${value?this.epicOf(value).name:'无'}`;
    const val=(field==='points')?parseInt(value,10):value;
    this.setState(s=>({ tasks:s.tasks.map(x=>x.id===id?{...x,[field]:val}:x) }));
    if(label) this.pushHist(id,label);
    this.showToast('已更新');
  }

  setQuickType = e => this.setState({ quickType:e.target.value });
  setQuickTitle = e => this.setState({ quickTitle:e.target.value });
  setQuickPoints = e => this.setState({ quickPoints:e.target.value });
  quickKey = e => { if(e.key==='Enter') this.addQuickTask(); };
  addQuickTask = () => {
    const title=(this.state.quickTitle||'').trim(); if(!title) return;
    const nums=this.state.tasks.map(t=>parseInt(t.id.split('-')[1],10)).filter(n=>n<300);
    const id='PM-'+(Math.max(0,...nums)+1);
    const t={ id, type:this.state.quickType, title, points:parseInt(this.state.quickPoints,10)||1, status:'TODO', assigneeId:null, epicId:null, sprintId:null };
    this.setState(s=>({ tasks:[t,...s.tasks], quickTitle:'' }));
    this.showToast('已创建 '+id);
  };
  setBacklogFilter = f => () => this.setState({ backlogFilter:f });
  moveToSprint = id => () => { this.setState(s=>({ tasks:s.tasks.map(x=>x.id===id?{...x,sprintId:'s24'}:x) })); this.showToast(id+' 已移入 Sprint 24'); };
  setCap = id => e => { const v=parseInt(e.target.value,10)||1; this.setState(s=>({ tasks:s.tasks })); const m=this.members.find(x=>x.id===id); if(m) m.cap=v; this.forceUpdate(); };

  setCommentDraft = e => this.setState({ commentDraft:e.target.value });
  commentKey = e => { if(e.key==='Enter') this.addComment(); };
  addComment = () => {
    const id=this.state.drawerId; const txt=(this.state.commentDraft||'').trim(); if(!id||!txt) return;
    this.setState(s=>{ const c=(s.comments[id]||this.seedComments(id)).slice(); c.push({ who:'张明', initials:'ZM', color:'#6e79d6', text:txt, time:'刚刚' }); return { comments:{...s.comments,[id]:c}, commentDraft:'' }; });
  };

  genToken = () => { const r=()=>Math.random().toString(36).slice(2); this.setState({ patToken:'pm_pat_'+r()+r() }); };
  copyToken = () => { navigator.clipboard && navigator.clipboard.writeText(this.state.patToken); this.showToast('Token 已复制'); };
  genInvite = () => this.setState({ inviteLink:'https://pm.acme.io/t/acme/invite/'+Math.random().toString(36).slice(2,11) });
  copyInvite = () => { navigator.clipboard && navigator.clipboard.writeText(this.state.inviteLink); this.showToast('邀请链接已复制'); };
  toggleRotate = () => this.setState(s=>({ autoRotate:!s.autoRotate }));
  toast_newSprint = () => this.showToast('新建 Sprint（示意）','info');
  startSprint = id => () => this.openConfirm({ title:'启动该 Sprint？', msg:'启动后当前进行中的 Sprint 将被关闭。', action:'启动', run:()=>this.showToast('Sprint 已启动') });

  openEpicModal = () => this.setState({ showEpicModal:true, epicName:'', epicColor:'#6e79d6', epicQuarter:'2026-Q3' });
  closeEpicModal = () => this.setState({ showEpicModal:false });
  setEpicName = e => this.setState({ epicName:e.target.value });
  setEpicQuarter = e => this.setState({ epicQuarter:e.target.value });
  pickEpicColor = c => () => this.setState({ epicColor:c });
  createEpic = () => {
    const name=(this.state.epicName||'').trim(); if(!name){ this.showToast('请输入名称','info'); return; }
    this.epics.push({ id:'e'+(this.epics.length+1), name, color:this.state.epicColor, quarter:this.state.epicQuarter||null });
    this.setState({ showEpicModal:false }); this.showToast('已创建 Epic：'+name);
  };

  onDragEnd = () => this.setState({ dragId:null, dragOverCol:null });

  // ---- view helpers ----
  tv(t, opts){ opts=opts||{};
    return { task:t, assignee:this.member(t.assigneeId), epic:this.epicOf(t.epicId),
      onOpen:this.openDrawer(t.id), flagged:!!opts.flagged,
      onDragStart:(e)=>{ if(e&&e.dataTransfer){ e.dataTransfer.effectAllowed='move'; } this.setState({dragId:t.id}); },
      moveToSprint:this.moveToSprint(t.id) }; }

  memberLoad(){ const act=this.activeTasks();
    return this.members.map(m=>{ const assigned=act.filter(t=>t.assigneeId===m.id).reduce((a,b)=>a+b.points,0);
      const cap=m.cap; const pct=Math.round(assigned/cap*100); const over=assigned>cap;
      const fillPct=Math.min(100,pct); const overW=over?Math.min(100,(assigned-cap)/cap*100):0;
      const bar={ __html: over
        ? `<span style="position:absolute;left:0;top:0;bottom:0;width:${100-overW/(1+overW/100)*0+ (cap/assigned*100)}%;background:var(--prog)"></span><span style="position:absolute;top:0;bottom:0;right:0;width:${(assigned-cap)/assigned*100}%;background:repeating-linear-gradient(45deg,var(--over),var(--over) 4px,transparent 4px,transparent 7px);border-left:1px solid var(--bg)"></span>`
        : `<span style="position:absolute;left:0;top:0;bottom:0;width:${fillPct}%;background:var(--prog)"></span>` };
      return { ...m, assigned, cap, pct, over, bar, numColor: over?'var(--over)':'var(--dim)', onCap:this.setCap(m.id) }; }); }

  burndown(){
    const total=this.activeTasks().reduce((a,b)=>a+b.points,0);
    const days=14, W=620, H=248, pl=40, pr=16, pt=14, pb=28;
    const pw=W-pl-pr, ph=H-pt-pb;
    const x=i=>pl+i*(pw/days), y=v=>pt+(1-v/total)*ph;
    let g='';
    for(let k=0;k<=4;k++){ const val=total*(1-k/4); const yy=pt+(k/4)*ph;
      g+=`<line x1="${pl}" y1="${yy}" x2="${W-pr}" y2="${yy}" stroke="var(--grid)"/><text x="${pl-7}" y="${yy+3}" text-anchor="end" font-size="9" fill="var(--faint)" font-family="'JetBrains Mono',monospace">${Math.round(val)}</text>`; }
    let xl=''; for(let d=0;d<=days;d+=2){ xl+=`<text x="${x(d)}" y="${H-9}" text-anchor="middle" font-size="9" fill="var(--faint)" font-family="'JetBrains Mono',monospace">${d}</text>`; }
    const ideal=[]; for(let i=0;i<=days;i++) ideal.push(`${x(i)},${y(total*(1-i/days))}`);
    const rem=[42,42,39,37,34,33,31,30].map(v=>Math.round(v/42*total));
    const remPts=rem.map((v,i)=>`${x(i)},${y(v)}`);
    const area=`${pl},${pt+ph} ${remPts.join(' ')} ${x(rem.length-1)},${pt+ph}`;
    return { __html:`<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">
      ${g}${xl}
      <polyline points="${ideal.join(' ')}" fill="none" stroke="var(--faint)" stroke-width="1.5" stroke-dasharray="4 4"/>
      <polygon points="${area}" fill="var(--accent)" fill-opacity="0.09"/>
      <polyline points="${remPts.join(' ')}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
      ${remPts.map(p=>{const c=p.split(',');return `<circle cx="${c[0]}" cy="${c[1]}" r="3" fill="var(--accent)"/>`;}).join('')}
    </svg>` };
  }

  navItem(key,label,icon,active,count){
    const base='display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border-radius:7px;font-size:13px;cursor:pointer;position:relative;transition:background .1s,color .1s;';
    const style=base + (active?'background:var(--accent-soft);color:var(--text);font-weight:550;':'color:var(--dim);font-weight:450;');
    return { key,label,icon:this.svg(icon),active,style,count,showCount:count!=null };
  }

  renderVals(){
    const s=this.state, ic=this.ic;
    const iconEl={}; Object.keys(ic).forEach(k=>{ iconEl[k]=this.svg(ic[k]); });
    const page=s.page;
    const themeLight='--bg:#ffffff;--panel:#fbfbfa;--card:#ffffff;--card-2:#f6f6f4;--card-hover:#f1f1ef;--border:#e6e6e3;--border-soft:#efefec;--border-strong:#d7d7d3;--shadow-xs:0 1px 2px rgba(0,0,0,.04);--shadow:0 1px 2px rgba(0,0,0,.05),0 12px 32px -14px rgba(0,0,0,.16);--text:#1a1c20;--dim:#6a6d75;--faint:#a2a4ab;--accent:#5b60d6;--accent-soft:rgba(91,96,214,.10);--todo:#8a8f98;--prog:#2f7fe0;--comp:#c07d1a;--done:#2f9e4a;--todo-soft:rgba(138,143,152,.12);--prog-soft:rgba(47,127,224,.10);--comp-soft:rgba(192,125,26,.12);--done-soft:rgba(47,158,74,.12);--type-story:#2f9e4a;--type-bug:#e0454f;--type-task:#67738a;--over:#e0454f;--grid:rgba(0,0,0,.05);';
    const theme = s.dark ? '' : themeLight;

    // nav
    const navMain=[
      this.navItem('dashboard','Dashboard',ic.dashboard,page==='dashboard'),
      this.navItem('backlog','Backlog',ic.backlog,page==='backlog',this.state.tasks.filter(t=>!t.sprintId).length),
      this.navItem('board','看板 Board',ic.board,page==='board',this.activeTasks().length),
      this.navItem('sprints','所有 Sprint',ic.sprints,page==='sprints'),
      this.navItem('planning','规划 Planning',ic.planning,page==='planning'),
      this.navItem('reports','报表 Reports',ic.reports,page==='reports'),
      this.navItem('roadmap','路线图 Roadmap',ic.roadmap,page==='roadmap')
    ].map(n=>({ ...n, onClick:this.setPage(n.key) }));
    const navAdmin=[
      this.navItem('admin','租户管理 Admin',ic.admin,page==='admin'),
      this.navItem('settings','个人设置 Settings',ic.settings,page==='settings')
    ].map(n=>({ ...n, onClick:this.setPage(n.key) }));

    // board
    const cols=[['TODO','待办','var(--todo)'],['IN_PROGRESS','进行中','var(--prog)'],['COMPLETED','待验收','var(--comp)'],['DONE','已完成','var(--done)']];
    const act=this.activeTasks();
    const boardColumns=cols.map(([key,label,dot])=>{
      const list=act.filter(t=>t.status===key);
      const hot=s.dragOverCol===key;
      const style=`flex:1;min-width:240px;display:flex;flex-direction:column;background:${hot?'var(--accent-soft)':'var(--panel)'};border:1px solid ${hot?'var(--accent)':'var(--border)'};border-radius:12px;padding:12px 10px 8px;min-height:0;transition:background .12s,border-color .12s;`;
      return { key,label,dot,count:list.length,style,empty:list.length===0,
        tasks:list.map(t=>this.tv(t,{flagged:this.memberLoad().find(m=>m.id===t.assigneeId&&m.over)?true:false})),
        onDragOver:(e)=>e.preventDefault(),
        onDragEnter:()=>{ if(s.dragOverCol!==key) this.setState({dragOverCol:key}); },
        onDrop:(e)=>{ e.preventDefault(); this.moveTask(s.dragId,key); } };
    });

    // dashboard
    const statusCards=cols.map(([key,label,dot])=>({ label:this.STATUS[key], dot, count:act.filter(t=>t.status===key).length }));
    const dashGroups=cols.map(([key,label,dot])=>{ const list=act.filter(t=>t.status===key && (t.type==='STORY'||t.type==='BUG'));
      return { label:this.STATUS[key], dot, count:list.length, empty:list.length===0, tasks:list.map(t=>this.tv(t)) }; });
    const total=act.reduce((a,b)=>a+b.points,0);
    const donePts=act.filter(t=>t.status==='DONE').reduce((a,b)=>a+b.points,0);
    const donePct=Math.round(donePts/total*100);
    const R=30, C=2*Math.PI*R, off=C*(1-donePct/100);
    const donutSvg={ __html:`<svg viewBox="0 0 74 74" width="74" height="74"><circle cx="37" cy="37" r="${R}" fill="none" stroke="var(--card-2)" stroke-width="7"/><circle cx="37" cy="37" r="${R}" fill="none" stroke="var(--done)" stroke-width="7" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 37 37)"/></svg>` };

    // backlog
    const bfList=[['ALL','全部'],['STORY','故事'],['BUG','缺陷'],['TASK','任务']];
    const backlogFilters=bfList.map(([v,l])=>{ const on=s.backlogFilter===v;
      return { label:l, onClick:this.setBacklogFilter(v), style:`padding:4px 11px;border-radius:6px;font-size:12px;cursor:pointer;transition:.1s;${on?'background:var(--accent);color:#fff;font-weight:600;':'color:var(--dim);'}` }; });
    let bl=this.state.tasks.filter(t=>!t.sprintId);
    if(s.backlogFilter!=='ALL') bl=bl.filter(t=>t.type===s.backlogFilter);
    const backlogRows=bl.map(t=>this.tv(t));

    // planning
    const planBacklog=this.state.tasks.filter(t=>!t.sprintId).map(t=>this.tv(t));
    const planSprint=act.map(t=>this.tv(t));
    const capacityRows=this.memberLoad();

    // sprints
    const sprintGroups=this.sprints.map(sp=>{ const list=this.state.tasks.filter(t=>t.sprintId===sp.id);
      const smap={ACTIVE:['ACTIVE','prog'],PLANNED:['PLANNED','todo'],CLOSED:['CLOSED','faint']};
      const sm=smap[sp.status]; const col=sp.status==='CLOSED'?'var(--faint)':(sp.status==='ACTIVE'?'var(--prog)':'var(--todo)');
      const badge={ __html:`<span style="display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;letter-spacing:.03em;color:${col};background:${sp.status==='ACTIVE'?'var(--prog-soft)':'var(--card-2)'};border-radius:20px;padding:3px 10px">${sp.status==='ACTIVE'?'<span style=\"width:6px;height:6px;border-radius:50%;background:var(--prog);animation:pulse 1.6s infinite\"></span>':''}${sm[0]}</span>` };
      return { name:sp.name, dates:sp.dates, badge, count:list.length, points:list.reduce((a,b)=>a+b.points,0),
        canStart:sp.status==='PLANNED', onStart:this.startSprint(sp.id), tasks:list.map(t=>this.tv(t)) }; });

    // reports
    const burndownSvg=this.burndown();

    // roadmap
    const quarters=['2026-Q3','2026-Q4',null];
    const roadmapQuarters=quarters.map(q=>{ const eps=this.epics.filter(e=>(e.quarter||null)===q);
      return { label: q||'未指定季度', epics: eps.map(e=>{ const ts=this.state.tasks.filter(t=>t.epicId===e.id);
        const tot=ts.reduce((a,b)=>a+b.points,0); const dn=ts.filter(t=>t.status==='DONE').reduce((a,b)=>a+b.points,0);
        const pct=tot?Math.round(dn/tot*100):0;
        return { name:e.name, color:e.color, done:dn, total:tot,
          bar:{ __html:`<span style="display:block;height:100%;width:${pct}%;background:${e.color};border-radius:4px"></span>` },
          tasks:ts.slice(0,4).map(t=>this.tv(t)) }; }) };
    }).filter(g=>g.epics.length);

    // admin
    const memberRows=this.members;
    const rotateToggle={ __html:`<span style="width:40px;height:23px;border-radius:12px;background:${s.autoRotate?'var(--accent)':'var(--card-2)'};border:1px solid ${s.autoRotate?'var(--accent)':'var(--border)'};display:inline-flex;align-items:center;padding:2px;transition:.15s;justify-content:${s.autoRotate?'flex-end':'flex-start'}"><span style="width:17px;height:17px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.3)"></span></span>` };

    // epic palette
    const pal=['#6e79d6','#3f9d6b','#d1a03a','#c74d8a','#4aa3c9','#d6673f'];
    const epicPalette=pal.map(c=>({ onPick:this.pickEpicColor(c),
      style:`width:30px;height:30px;border-radius:8px;background:${c};cursor:pointer;border:2px solid ${s.epicColor===c?'var(--text)':'transparent'};box-shadow:0 0 0 2px var(--bg) inset;transition:.1s;` }));

    // drawer
    const selStyle='width:100%;height:30px;border-radius:7px;border:1px solid var(--border);background:var(--card-2);color:var(--text);font-size:12.5px;padding:0 26px 0 10px;cursor:pointer;';
    let drawer=null;
    if(s.drawerId){ const t=this.state.tasks.find(x=>x.id===s.drawerId);
      if(t){ const typeIconMap={STORY:this.svg('<path style="stroke:var(--type-story)" d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>'),BUG:this.svg('<g style="stroke:var(--type-bug)"><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M9 7v-1a3 3 0 1 1 6 0v1"/></g>'),TASK:this.svg('<g style="stroke:var(--type-task)"><path d="M21 10.5V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/><path d="m9 11 3 3L22 4"/></g>')};
        const sv=this.SVAR[t.status];
        const tabS=(on)=>`padding:8px 12px;font-size:12.5px;cursor:pointer;border-bottom:2px solid ${on?'var(--accent)':'transparent'};color:${on?'var(--text)':'var(--dim)'};font-weight:${on?'600':'450'};margin-bottom:-1px;`;
        const hist=(s.hist[t.id]||this.seedHist(t.id));
        drawer={ id:t.id, title:t.title, desc:'当前实现存在边界问题，需要在交互层补齐处理逻辑并补充自动化用例。此描述为示意文案。',
          typeIcon:typeIconMap[t.type], status:t.status, type:t.type, points:String(t.points),
          assigneeId:t.assigneeId||'', epicId:t.epicId||'',
          statusSelStyle:selStyle+`color:var(--${sv});font-weight:600;`,
          onTitle:e=>this.changeTask(t.id,'title',e.target.value),
          onStatus:e=>this.changeTask(t.id,'status',e.target.value),
          onType:e=>this.changeTask(t.id,'type',e.target.value),
          onPoints:e=>this.changeTask(t.id,'points',e.target.value),
          onAssignee:e=>this.changeTask(t.id,'assigneeId',e.target.value),
          onEpic:e=>this.changeTask(t.id,'epicId',e.target.value),
          showComments:s.drawerTab==='comments', showHistory:s.drawerTab==='history',
          tabCommentsStyle:tabS(s.drawerTab==='comments'), tabHistoryStyle:tabS(s.drawerTab==='history'),
          comments:(s.comments[t.id]||this.seedComments(t.id)),
          history:hist.map((h,i)=>({ ...h, lineStyle:`width:1px;flex:1;background:var(--border);margin-top:3px;${i===hist.length-1?'display:none':''}` })) };
      }
    }
    const statusOptions=Object.keys(this.STATUS).map(k=>({value:k,label:this.STATUS[k]}));
    const typeOptions=Object.keys(this.TYPE).map(k=>({value:k,label:this.TYPE[k]}));
    const pointsOptions=[1,2,3,5,8].map(p=>({value:String(p),label:p+' pts'}));
    const memberOptions=[{value:'',label:'未分配'}].concat(this.members.map(m=>({value:m.id,label:m.name})));
    const epicOptions=[{value:'',label:'无'}].concat(this.epics.map(e=>({value:e.id,label:e.name})));

    // toast
    const toastIconMap={ success:this.svg('<circle cx="12" cy="12" r="10" style="stroke:var(--done)"/><path d="m9 12 2 2 4-4" style="stroke:var(--done)"/>'), info:this.svg('<circle cx="12" cy="12" r="10" style="stroke:var(--accent)"/><path d="M12 16v-4M12 8h.01" style="stroke:var(--accent)"/>') };
    const toastIcon=s.toast?(toastIconMap[s.toast.kind]||toastIconMap.success):toastIconMap.success;

    const pulseDot={ __html:'<span style="width:8px;height:8px;border-radius:50%;background:var(--prog);animation:pulse 1.6s infinite"></span>' };

    return {
      theme, expanded:!s.collapsed, collapsed:s.collapsed,
      sidebarStyle:`width:${s.collapsed?'60px':'224px'};`,
      icons:iconEl, themeIcon:this.svg(s.dark?ic.sun:ic.moon),
      navMain, navAdmin,
      toggleTheme:this.toggleTheme, toggleCollapse:this.toggleCollapse,
      toggleProjMenu:this.toggleProjMenu, projMenu:s.projMenu,
      toggleUserMenu:this.toggleUserMenu, userMenu:s.userMenu,
      goSettings:this.goSettings, logout:this.logout, openCreate:this.openCreate,
      isBoard:page==='board', isDashboard:page==='dashboard', isBacklog:page==='backlog',
      isPlanning:page==='planning', isSprints:page==='sprints', isReports:page==='reports',
      isRoadmap:page==='roadmap', isAdmin:page==='admin', isSettings:page==='settings',
      boardColumns, onDragEnd:this.onDragEnd,
      statusCards, dashGroups, donutSvg, loading:s.loading, notLoading:!s.loading, refresh:this.refresh,
      backlogFilters, backlogRows, backlogEmpty:backlogRows.length===0, backlogTotal:this.state.tasks.filter(t=>!t.sprintId).length,
      quickType:s.quickType, setQuickType:this.setQuickType, quickTitle:s.quickTitle, setQuickTitle:this.setQuickTitle,
      quickPoints:s.quickPoints, setQuickPoints:this.setQuickPoints, quickKey:this.quickKey, addQuickTask:this.addQuickTask,
      planBacklog, planSprint, planSprintPts:act.reduce((a,b)=>a+b.points,0), capacityRows, pulseDot,
      sprintGroups, toast_newSprint:this.toast_newSprint,
      burndownSvg,
      roadmapQuarters, openEpicModal:this.openEpicModal,
      memberRows, genInvite:this.genInvite, inviteLink:s.inviteLink, copyInvite:this.copyInvite,
      toggleRotate:this.toggleRotate, rotateToggle,
      genToken:this.genToken, patToken:s.patToken, noPat:!s.patToken, copyToken:this.copyToken,
      drawerOpen:!!drawer, drawer, closeDrawer:this.closeDrawer, tabComments:this.tabComments, tabHistory:this.tabHistory,
      selStyle, statusOptions, typeOptions, pointsOptions, memberOptions, epicOptions,
      commentDraft:s.commentDraft, setCommentDraft:this.setCommentDraft, commentKey:this.commentKey, addComment:this.addComment,
      showEpicModal:s.showEpicModal, closeEpicModal:this.closeEpicModal, stop:this.stop,
      epicName:s.epicName, setEpicName:this.setEpicName, epicPalette, epicQuarter:s.epicQuarter, setEpicQuarter:this.setEpicQuarter, createEpic:this.createEpic,
      confirm:s.confirm, closeConfirm:this.closeConfirm, doConfirm:this.doConfirm,
      toast:s.toast, toastIcon,
      showAuth:s.showAuth, authTab:s.authTab, isRegister:s.authTab==='register',
      authLogin:this.authLogin, authRegister:this.authRegister, enterApp:this.enterApp,
      authCta:s.authTab==='register'?'创建团队':'登录',
      authLoginStyle:`flex:1;text-align:center;padding:7px;border-radius:7px;font-size:12.5px;cursor:pointer;${s.authTab==='login'?'background:var(--card);color:var(--text);font-weight:600;box-shadow:var(--shadow-xs);':'color:var(--dim);'}`,
      authRegisterStyle:`flex:1;text-align:center;padding:7px;border-radius:7px;font-size:12.5px;cursor:pointer;${s.authTab==='register'?'background:var(--card);color:var(--text);font-weight:600;box-shadow:var(--shadow-xs);':'color:var(--dim);'}`
    };
  }
}
