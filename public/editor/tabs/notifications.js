// editor/tabs/notifications.js — colonne « Notifications ».
// Builder de rendu pur (câblage dans wireEditor). Extrait verbatim.
// cf. docs/web-app-split-proposal.md

export function renderNotificationsColumn(data, { notifListHtml }) {
  return `<div class="card">
      <div class="section-title" style="border-top:none;padding-top:0;margin-top:0">Notifications</div>
      <div class="rel-filters" style="justify-content:space-between">
        <span class="deg" id="notif-count">${data.unread || 0} non lue(s)</span>
        <button class="btn sm" id="notif-readall">Tout marquer lu</button>
      </div>
      <div class="col-scroll">
        <ul class="notif-list notif-col" id="notif-list">${notifListHtml(data.notifications || [])}</ul>
      </div>
    </div>`;
}
