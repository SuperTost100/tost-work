// Full mockup: fills the sidebar, draws MingCute icons as masks so they take the text colour,
// and builds the mockup bar (theme switch and a screen picker).
(() => {
  const LOGO = '<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="var(--ink)"/><path d="M14 17h36v6H35v26h-6V23H14z" fill="var(--canvas)"/></svg>';

  const sideTpl = `
    <div class="chrome"><span class="lights"><i></i><i></i><i></i></span><span class="grow"></span><button class="iconbtn" title="Collapse sidebar"><i data-i="layout-leftbar-close"></i></button></div>
    <div class="brand">${LOGO}<b>Tost Work</b></div>
    <div class="search"><i data-i="search"></i>Search<kbd>⌘K</kbd></div>
    <a class="nav" data-k="new" href="#home"><i data-i="edit"></i>New task</a>
    <a class="nav" data-k="projects" href="#projects"><i data-i="folder"></i>Projects</a>
    <a class="nav" data-k="skills" href="#skills"><i data-i="magic-2"></i>Skills</a>
    <a class="nav" data-k="jobs" href="#jobs"><i data-i="calendar"></i>Jobs</a>
    <a class="nav" data-k="board" href="#board"><i data-i="task"></i>Board</a>
    <h4>Recent</h4>
    <a class="rec" data-k="task" href="#task">Proposal for Alpi Logistica</a>
    <a class="rec split" href="#board"><span class="truncate">Supplier contracts summary</span><span class="tag mine">needs you</span></a>
    <a class="rec" data-k="done" href="#done">Proposal for Cantina Ferraris</a>
    <a class="rec" data-k="quick" href="#quick">letter-bank.docx</a>
    <a class="rec">Monday press review</a>
    <a class="rec">Rewrite the About page</a>
    <span class="spacer"></span>
    <div class="me"><span class="avatar">G</span><span class="who grow">Giulia Rossi<span>Studio Rossi</span></span><a class="iconbtn" href="#settings" title="Settings"><i data-i="settings-3"></i></a></div>`;

  for (const s of document.querySelectorAll("[data-side]")) {
    s.innerHTML = sideTpl;
    s.querySelector(`[data-k="${s.dataset.on}"]`)?.classList.add("on");
  }
  for (const el of document.querySelectorAll("[data-logo]")) el.innerHTML = LOGO;

  for (const i of document.querySelectorAll("i[data-i]")) {
    const span = document.createElement("span");
    span.className = ("ic " + i.className).trim();
    if (i.getAttribute("style")) span.setAttribute("style", i.getAttribute("style"));
    const url = `url("icons/${i.dataset.i}.svg")`;
    span.style.maskImage = url;
    span.style.webkitMaskImage = url;
    i.replaceWith(span);
  }

  const screens = [...document.querySelectorAll(".screen")];
  const nav = document.getElementById("mocknav");
  nav.innerHTML = "<b>Tost Work · full mockup</b>";
  const link = (label, fn) => { const a = document.createElement("a"); a.textContent = label; a.onclick = fn; nav.appendChild(a); return a; };
  const sep = () => { const s = document.createElement("span"); s.className = "sep"; nav.appendChild(s); };
  const themeLinks = ["light", "dark"].map((t) => [t, link(t === "light" ? "Light" : "Dark", () => setTheme(t))]);
  sep();
  const prev = link("‹", () => step(-1));
  const select = document.createElement("select");
  const groups = {};
  for (const s of screens) {
    const g = s.dataset.group || "Screens";
    if (!groups[g]) { groups[g] = document.createElement("optgroup"); groups[g].label = g; select.appendChild(groups[g]); }
    const o = document.createElement("option");
    o.value = s.id.slice(2);
    o.textContent = s.dataset.title;
    groups[g].appendChild(o);
  }
  select.onchange = () => (location.hash = select.value);
  nav.appendChild(select);
  const next = link("›", () => step(1));
  sep();
  const back = document.createElement("a"); back.href = "../index.html"; back.textContent = "All rounds"; nav.appendChild(back);

  function step(d) {
    const i = screens.findIndex((s) => s.classList.contains("on"));
    location.hash = screens[(i + d + screens.length) % screens.length].id.slice(2);
  }
  function setTheme(t) {
    document.body.dataset.theme = t;
    for (const [k, a] of themeLinks) a.classList.toggle("on", k === t);
  }
  function show() {
    const target = document.getElementById("s-" + (location.hash.slice(1) || "home")) || screens[0];
    for (const s of screens) s.classList.toggle("on", s === target);
    select.value = target.id.slice(2);
  }
  const q = new URLSearchParams(location.search);
  setTheme(q.get("theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  addEventListener("hashchange", show);
  addEventListener("keydown", (e) => {
    if (e.target.closest("textarea, input, select")) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });
  show();
})();
