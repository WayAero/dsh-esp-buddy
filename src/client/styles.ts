import navigationIcon from './assets/esp-buddy-nav-icon.png'

export const STYLE_ID = 'dsh-esp-buddy-style'

export const cssText = `
.dsh_espBuddy_card { list-style:none; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-3); transition:border-color .16s,background .16s; }
.dsh_espBuddy_page { list-style:none; margin:0; }
.dsh_espBuddy_pageHeader { margin:0 0 16px; }
.dsh_espBuddy_pageHeader h2 { margin:0; color:var(--dsw-alias-label-primary); font-size:22px; line-height:30px; font-weight:600; }
.dsh_espBuddy_pageHeader p { margin:6px 0 0; color:var(--dsw-alias-label-tertiary); font-size:14px; line-height:20px; }
.dsh_espBuddy_version { display:inline-flex; align-items:center; width:max-content; margin-left:8px; padding:1px 8px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; color:var(--dsw-alias-label-tertiary); font-size:12px; font-weight:500; vertical-align:middle; }
.dsh_espBuddy_pluginCardRow { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:14px 16px; }
.dsh_espBuddy_pluginCard .dsh_espBuddy_actions { flex:none; margin:0; }
.dsh_espBuddy_pluginCardHint { margin:0 16px 14px; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
.dsh_espBuddy_cardName { color:var(--dsw-alias-label-primary); font-size:15px; line-height:1.4; font-weight:600; }
.dsh_espBuddy_cardBody { margin:0 16px; padding:16px 0 8px; border-top:1px solid var(--dsw-alias-border-l2); }
.dsh_espBuddy_page .dsh_espBuddy_cardBody { margin:0; padding:0; border:0; }
.dsh_espBuddy_section { display:flex; flex-direction:column; gap:16px; min-width:0; }
.dsh_espBuddy_enableRow { display:flex; align-items:flex-start; gap:12px; padding:14px 16px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-1); cursor:pointer; }
.dsh_espBuddy_enableRow input, .dsh_espBuddy_toggleField input { flex:none; width:18px; height:18px; margin:2px 0 0; accent-color:var(--dsw-alias-brand-primary); cursor:pointer; }
.dsh_espBuddy_enableRow span, .dsh_espBuddy_field span { display:flex; flex-direction:column; gap:2px; min-width:0; }
.dsh_espBuddy_enableRow strong, .dsh_espBuddy_field strong { color:var(--dsw-alias-label-primary); font-size:14px; line-height:22px; font-weight:500; }
.dsh_espBuddy_enableRow small, .dsh_espBuddy_field small { color:var(--dsw-alias-label-tertiary); font-size:13px; line-height:20px; }
.dsh_espBuddy_group { padding:16px; border:1px solid var(--dsw-alias-border-l2); border-radius:12px; background:var(--dsw-alias-bg-layer-1); }
.dsh_espBuddy_groupHeader { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:14px; }
.dsh_espBuddy_groupHeader h3 { margin:0; color:var(--dsw-alias-label-primary); font-size:15px; line-height:22px; font-weight:600; }
.dsh_espBuddy_cancelPack { height:30px; margin-left:auto; padding:0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:12px; cursor:pointer; }
.dsh_espBuddy_cancelPack:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.dsh_espBuddy_cancelPack:disabled { cursor:default; opacity:.55; }
.dsh_espBuddy_groupDesc { margin:-4px 0 14px; color:var(--dsw-alias-label-tertiary); font-size:13px; line-height:20px; }
.dsh_espBuddy_connection { display:inline-flex; align-items:center; gap:7px; color:var(--dsw-alias-label-tertiary); font-size:13px; }
.dsh_espBuddy_connection i { width:8px; height:8px; border-radius:50%; background:#fff; box-shadow:0 0 0 1px var(--dsw-alias-border-l2); }
.dsh_espBuddy_connection.is-connected { color:var(--dsw-alias-label-primary); }
.dsh_espBuddy_connection.is-connected i { background:var(--dsw-alias-state-success-primary); box-shadow:none; }
.dsh_espBuddy_connection.is-error i { background:var(--dsw-alias-state-error-primary); box-shadow:none; }
.dsh_espBuddy_statusGrid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:0 24px; margin:0; }
.dsh_espBuddy_statusGrid div { display:flex; justify-content:space-between; gap:12px; padding:9px 0; border-top:1px solid var(--dsw-alias-border-l2); }
.dsh_espBuddy_statusGrid dt { color:var(--dsw-alias-label-tertiary); font-size:13px; }
.dsh_espBuddy_statusGrid dd { min-width:0; margin:0; color:var(--dsw-alias-label-primary); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh_espBuddy_error { margin:12px 0 0; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; overflow-wrap:anywhere; }
.dsh_espBuddy_error strong { color:var(--dsw-alias-label-primary); font-weight:500; }
.dsh_espBuddy_actions { display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-top:14px; }
.dsh_espBuddy_actions button { height:32px; padding:0 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; cursor:pointer; }
.dsh_espBuddy_actions button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.dsh_espBuddy_actions button:disabled { cursor:not-allowed; opacity:.55; }
.dsh_espBuddy_actionState { color:var(--dsw-alias-state-success-primary); font-size:12px; }
.dsh_espBuddy_actionState.is-failed { color:var(--dsw-alias-state-error-primary); }
.dsh_espBuddy_removeButton { color:var(--dsw-alias-state-error-primary) !important; }
[data-dsh-esp-buddy-settings-nav] > svg:first-child { display:none; }
[data-dsh-esp-buddy-settings-nav]::before { content:''; flex:none; width:16px; height:16px; background:center / contain no-repeat url('${navigationIcon}'); }
.dsh_espBuddy_dropZone { display:flex; flex-direction:column; align-items:center; gap:5px; padding:22px 16px; border:1px dashed var(--dsw-alias-border-l2); border-radius:10px; background:var(--dsw-alias-bg-layer-2); text-align:center; transition:border-color .15s ease,background .15s ease; }
.dsh_espBuddy_dropZone.is-dragging { border-color:var(--dsw-alias-brand-primary); background:var(--dsw-alias-interactive-bg-hover); }
.dsh_espBuddy_dropZone strong { color:var(--dsw-alias-label-primary); font-size:14px; font-weight:500; }
.dsh_espBuddy_dropZone span, .dsh_espBuddy_packSummary small, .dsh_espBuddy_packHint { color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
.dsh_espBuddy_dropZone button, .dsh_espBuddy_packSummary button { height:32px; margin-top:6px; padding:0 12px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; cursor:pointer; }
.dsh_espBuddy_dropZone button:hover:not(:disabled), .dsh_espBuddy_packSummary button:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.dsh_espBuddy_dropZone button:disabled, .dsh_espBuddy_packSummary button:disabled { cursor:not-allowed; opacity:.55; }
.dsh_espBuddy_packSummary { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:12px; }
.dsh_espBuddy_packSummary > span { display:flex; flex-direction:column; min-width:0; }
.dsh_espBuddy_packSummary strong { overflow:hidden; color:var(--dsw-alias-label-primary); font-size:13px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
.dsh_espBuddy_packSummary button { flex:none; margin:0; }
.dsh_espBuddy_packPhase { color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsh_espBuddy_packPhase.is-completed { color:var(--dsw-alias-state-success-primary); }
.dsh_espBuddy_packPhase.is-failed, .dsh_espBuddy_packError { color:var(--dsw-alias-state-error-primary); }
.dsh_espBuddy_progress { margin-top:14px; }
.dsh_espBuddy_progress > div { display:flex; justify-content:space-between; gap:12px; color:var(--dsw-alias-label-tertiary); font-size:12px; }
.dsh_espBuddy_progress > div span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dsh_espBuddy_progress > div strong { color:var(--dsw-alias-label-primary); font-weight:500; }
.dsh_espBuddy_progress > i { display:block; height:6px; margin-top:7px; overflow:hidden; border-radius:999px; background:var(--dsw-alias-bg-layer-3); }
.dsh_espBuddy_progress > i b { position:relative; display:block; height:100%; overflow:hidden; border-radius:inherit; background:var(--dsw-alias-brand-primary); transition:width .42s cubic-bezier(.2,.8,.2,1); will-change:width; }
.dsh_espBuddy_progress.is-sending > i b::after { content:''; position:absolute; inset:0 auto 0 -45%; width:34%; background:linear-gradient(90deg,transparent,rgba(255,255,255,.48),transparent); animation:dsh_espBuddy_progressSheen 1.25s ease-in-out infinite; }
@keyframes dsh_espBuddy_progressSheen { to { transform:translateX(430%); } }
.dsh_espBuddy_progress > small { display:block; margin-top:7px; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
.dsh_espBuddy_packInstalled { margin:12px 0 0; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; }
.dsh_espBuddy_packInstalled strong { color:var(--dsw-alias-label-primary); font-weight:500; }
.dsh_espBuddy_packHint, .dsh_espBuddy_packError { margin:10px 0 0; font-size:12px; line-height:18px; overflow-wrap:anywhere; }
.dsh_espBuddy_field { display:grid; grid-template-columns:minmax(0,1fr) 180px; align-items:center; gap:20px; padding:12px 0; border-top:1px solid var(--dsw-alias-border-l2); }
.dsh_espBuddy_field > input[type='text'], .dsh_espBuddy_field > input[type='number'] { width:100%; box-sizing:border-box; height:34px; padding:0 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:8px; background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; outline:none; }
.dsh_espBuddy_field > input:focus { border-color:var(--dsw-alias-brand-primary); }
.dsh_espBuddy_toggleField { grid-template-columns:minmax(0,1fr) 18px; }
.dsh_espBuddy_field input:disabled { cursor:not-allowed; opacity:.55; }
.dsh_espBuddy_save { color:var(--dsw-alias-brand-primary); font-size:12px; }
.dsh_espBuddy_save.is-failed { color:var(--dsw-alias-label-primary); }
@media (prefers-reduced-motion:reduce) {
  .dsh_espBuddy_progress > i b { transition:none; }
  .dsh_espBuddy_progress.is-sending > i b::after { animation:none; }
}
@media (max-width:700px) {
  .dsh_espBuddy_statusGrid { grid-template-columns:1fr; }
  .dsh_espBuddy_field { grid-template-columns:1fr; gap:8px; }
  .dsh_espBuddy_toggleField { grid-template-columns:minmax(0,1fr) 18px; }
}
`

export function adoptStyles(): void {
  if (document.getElementById(STYLE_ID) !== null) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = cssText
  document.head.appendChild(style)
}
