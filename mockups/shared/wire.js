// Shows one screen per URL hash and builds the dashed mockup navigator.
// Each screen is <section class="screen" id="s-NAME" data-title="Label">.
(() => {
  const screens = [...document.querySelectorAll(".screen")];
  const nav = document.querySelector(".mocknav");

  if (nav) {
    for (const s of screens) {
      if (s.dataset.hidden !== undefined) continue;
      const a = document.createElement("a");
      a.href = "#" + s.id.slice(2);
      a.textContent = s.dataset.title;
      nav.appendChild(a);
    }
    const sep = document.createElement("span");
    sep.className = "sep";
    nav.appendChild(sep);
    const back = document.createElement("a");
    back.href = "../index.html";
    back.textContent = "All directions";
    nav.appendChild(back);
  }

  function show() {
    const name = location.hash.slice(1) || screens[0].id.slice(2);
    const target = document.getElementById("s-" + name) || screens[0];
    for (const s of screens) s.classList.toggle("on", s === target);
    if (nav) {
      for (const a of nav.querySelectorAll("a")) a.classList.toggle("on", a.getAttribute("href") === "#" + target.id.slice(2));
    }
    const title = document.querySelector(".titlebar .where");
    if (title) title.textContent = target.dataset.title;
  }

  // data-toggle="#id" flips the "open" class on the target, for drawers and side panels.
  // data-open and data-close set it explicitly, for tabs that switch a panel.
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-toggle], [data-open], [data-close]");
    if (!t) return;
    e.preventDefault();
    if (t.dataset.toggle) document.querySelector(t.dataset.toggle)?.classList.toggle("open");
    if (t.dataset.open) document.querySelector(t.dataset.open)?.classList.add("open");
    if (t.dataset.close) document.querySelector(t.dataset.close)?.classList.remove("open");
  });

  addEventListener("hashchange", show);
  show();
})();
