// -*- coding: utf-8 -*-

/**
 * Modal
 *
 * 弹窗：用于确认、危险操作、短表单。
 */
export function openModal({ title, body }) {
  const root = document.querySelector("#modal-root");
  root.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal">
      <div class="modal-header">${escapeHtml(title)}</div>
      <div class="modal-body">${body}</div>
    </div>
  `;

  root.querySelector(".modal-backdrop").addEventListener("click", () => {
    root.innerHTML = "";
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[c]));
}
