(() => {
  "use strict";

  const CONFIG = {
    repo: "temirlan2994/zamer-cad-releases",
    // Ссылки на оплату картой. Пока ссылка пустая, кнопка «Купить»
    // открывает окно «Оплата картой — совсем скоро» с кнопкой скачивания.
    checkout: {
      month: "",
      year: "",
    },
  };

  const ua = navigator.userAgent || "";
  const isAndroid = /android/i.test(ua);
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const releasePrefix = `https://github.com/${CONFIG.repo}/releases/download/`;

  // ----- Последняя версия APK -------------------------------------------
  const apk = { url: document.querySelector("[data-apk-href]")?.href || "", version: "", size: 0 };
  const sizeFormat = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });
  const releaseKey = "zamer-site-release-v1";

  const validUrl = (url) => typeof url === "string" && url.startsWith(releasePrefix) && /\.apk$/i.test(url);
  const validVersion = (version) => /^\d+(\.\d+){1,3}$/.test(version);

  function applyRelease() {
    if (!validUrl(apk.url)) return;
    document.querySelectorAll("[data-apk-href]").forEach((link) => { link.href = apk.url; });
    if (validVersion(apk.version)) {
      document.querySelectorAll("[data-apk-version]").forEach((el) => { el.textContent = apk.version; });
    }
    if (apk.size > 0) {
      const size = `${sizeFormat.format(apk.size / 1048576)} МБ`;
      document.querySelectorAll("[data-apk-size]").forEach((el) => { el.textContent = size; });
    }
  }

  async function loadRelease() {
    try {
      const cached = JSON.parse(sessionStorage.getItem(releaseKey) || "null");
      if (cached && Date.now() - cached.at < 10 * 60 * 1000 && validUrl(cached.url)) {
        Object.assign(apk, { url: cached.url, version: cached.version, size: cached.size });
        applyRelease();
        return;
      }
    } catch { /* storage may be unavailable */ }

    try {
      const response = await fetch(`https://api.github.com/repos/${CONFIG.repo}/releases/latest`, {
        headers: { Accept: "application/vnd.github+json" },
      });
      if (!response.ok) return;
      const release = await response.json();
      const asset = (release.assets || []).find((item) => /\.apk$/i.test(item.name || ""));
      if (!asset || !validUrl(asset.browser_download_url)) return;
      apk.url = asset.browser_download_url;
      apk.version = String(release.tag_name || "").replace(/^v/i, "");
      apk.size = Number(asset.size) || 0;
      applyRelease();
      try {
        sessionStorage.setItem(releaseKey, JSON.stringify({ url: apk.url, version: apk.version, size: apk.size, at: Date.now() }));
      } catch { /* ignore */ }
    } catch { /* offline or rate limited: static link stays */ }
  }

  const releaseReady = loadRelease();

  // ----- Окна -------------------------------------------------------------
  function openModal(name) {
    const dialog = document.getElementById(`modal-${name}`);
    if (!dialog) return;
    document.querySelectorAll("dialog[open]").forEach((open) => open.close());
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  document.querySelectorAll("dialog.modal").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      const outside = event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
      if (outside) dialog.close();
    });
  });

  // ----- Скачивание и покупка -------------------------------------------
  document.querySelectorAll("[data-checkout]").forEach((link) => {
    const url = CONFIG.checkout[link.dataset.checkout];
    if (url) {
      link.href = url;
      link.rel = "noopener";
    }
  });

  document.addEventListener("click", (event) => {
    const download = event.target.closest("[data-download]");
    if (download) {
      if (isAndroid) {
        // Браузер сам скачивает файл по ссылке, а мы показываем, как установить.
        window.setTimeout(() => openModal("install"), 350);
        return;
      }
      event.preventDefault();
      openModal(isIOS ? "ios" : "desktop");
      return;
    }
    const buy = event.target.closest("[data-checkout]");
    if (buy && !CONFIG.checkout[buy.dataset.checkout]) {
      event.preventDefault();
      openModal("soon");
    }
  });

  // Короткая ссылка /download (QR-код) ведёт сюда с ?dl=1.
  const params = new URLSearchParams(window.location.search);
  if (params.has("dl")) {
    window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    if (isAndroid) {
      const timeout = new Promise((resolve) => window.setTimeout(resolve, 2500));
      Promise.race([releaseReady, timeout]).then(() => {
        window.location.href = apk.url;
        window.setTimeout(() => openModal("install"), 450);
      });
    } else {
      openModal(isIOS ? "ios" : "desktop");
    }
  }

  // ----- Копирование ссылки ----------------------------------------------
  document.querySelectorAll("[data-copy]").forEach((button) => {
    const label = button.querySelector("span");
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copy);
        label.textContent = "Скопировано";
      } catch {
        const code = button.parentElement.querySelector("code");
        const range = document.createRange();
        range.selectNodeContents(code);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        label.textContent = "Выделено";
      }
      window.setTimeout(() => { label.textContent = "Копировать"; }, 2200);
    });
  });

  // ----- Появление блоков при прокрутке ----------------------------------
  if (!reduceMotion && "IntersectionObserver" in window) {
    const below = [...document.querySelectorAll(".reveal")]
      .filter((el) => el.getBoundingClientRect().top > window.innerHeight * 0.92);
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.remove("pending");
        observer.unobserve(entry.target);
      }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.06 });
    below.forEach((el) => {
      const siblings = [...el.parentElement.children].filter((child) => child.classList.contains("reveal"));
      el.style.transitionDelay = `${Math.min(siblings.indexOf(el), 3) * 70}ms`;
      el.classList.add("pending");
      observer.observe(el);
    });
  }

  // ----- Нижняя кнопка на телефоне ---------------------------------------
  const dock = document.getElementById("dock");
  const heroCta = document.getElementById("hero-cta");
  const finalCta = document.getElementById("final-cta");
  if (dock && heroCta && finalCta && "IntersectionObserver" in window) {
    const dockLink = dock.querySelector("a");
    // Хостинг может закрепить внизу свой бейдж (iframe). Кнопку поднимаем над
    // ним, а сам бейдж не трогаем.
    const placeDock = () => {
      let lift = 0;
      for (const frame of document.querySelectorAll("iframe")) {
        if (dock.contains(frame) || getComputedStyle(frame).position !== "fixed") continue;
        const box = frame.getBoundingClientRect();
        if (!box.height || box.top < window.innerHeight / 2) continue;
        lift = Math.max(lift, window.innerHeight - box.top);
      }
      dock.style.bottom = lift ? `${Math.round(lift + 10)}px` : "";
    };
    new MutationObserver(placeDock).observe(document.body, { childList: true });
    window.addEventListener("resize", placeDock);
    window.addEventListener("load", placeDock);
    let heroPassed = false;
    let finalReached = false;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === heroCta) heroPassed = !entry.isIntersecting && entry.boundingClientRect.top < 0;
        if (entry.target === finalCta) finalReached = entry.isIntersecting || entry.boundingClientRect.bottom < 0;
      }
      const show = heroPassed && !finalReached;
      if (show) placeDock();
      dock.classList.toggle("show", show);
      dock.setAttribute("aria-hidden", String(!show));
      dockLink.tabIndex = show ? 0 : -1;
    });
    observer.observe(heroCta);
    observer.observe(finalCta);
  }

  // ----- Ролики инструментов ---------------------------------------------
  // Ролики идут по кругу, пока посетитель сам не выберет инструмент.
  const tools = document.querySelector("[data-tools]");
  if (tools) {
    const row = tools.querySelector('[role="tablist"]');
    const tabs = [...row.querySelectorAll('[role="tab"]')];
    const video = tools.querySelector("video");
    const progress = tools.querySelector(".tool-progress span");
    let current = 0;
    let tour = !reduceMotion;
    let visible = false;
    if (reduceMotion) video.controls = true;
    const play = () => {
      if (visible && !reduceMotion) video.play().catch(() => {});
    };
    const select = (index, { focus = false, user = false } = {}) => {
      current = (index + tabs.length) % tabs.length;
      if (user) tour = false;
      tabs.forEach((tab, i) => {
        const active = i === current;
        tab.setAttribute("aria-selected", String(active));
        tab.tabIndex = active ? 0 : -1;
        document.getElementById(tab.getAttribute("aria-controls")).hidden = !active;
      });
      const tab = tabs[current];
      if (!video.src.endsWith(tab.dataset.video)) {
        video.poster = tab.dataset.poster;
        video.src = tab.dataset.video;
      }
      video.loop = !tour;
      video.setAttribute("aria-label", `Демонстрация: ${tab.textContent.trim().toLowerCase()}`);
      if (progress) progress.style.transform = "scaleX(0)";
      if (row.scrollWidth > row.clientWidth) {
        row.scrollTo({ left: tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2, behavior: reduceMotion ? "auto" : "smooth" });
      }
      if (focus) tab.focus();
      play();
    };
    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => select(i, { user: true }));
      tab.addEventListener("keydown", (event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        const jump = { Home: 0, End: tabs.length - 1 }[event.key];
        if (step === undefined && jump === undefined) return;
        event.preventDefault();
        select(step === undefined ? jump : current + step, { focus: true, user: true });
      });
    });
    video.addEventListener("ended", () => {
      if (tour) select(current + 1);
    });
    video.addEventListener("timeupdate", () => {
      if (progress && video.duration) progress.style.transform = `scaleX(${video.currentTime / video.duration})`;
    });
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) play();
        else video.pause();
      }, { threshold: 0.4 }).observe(video);
    }
  }

  // ----- «Дальномер» в первом экране ------------------------------------
  const counter = document.querySelector("[data-count]");
  if (counter && !reduceMotion) {
    const values = [4800, 2600, 3800, 2200, 6600];
    const numbers = new Intl.NumberFormat("ru-RU");
    let index = 0;
    let current = values[0];
    let timer = 0;
    const animateTo = (target) => {
      const from = current;
      const started = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - started) / 900);
        const eased = 1 - (1 - t) ** 3;
        current = Math.round((from + (target - from) * eased) / 10) * 10;
        counter.textContent = numbers.format(current);
        if (t < 1) window.requestAnimationFrame(step);
      };
      window.requestAnimationFrame(step);
    };
    const tick = () => {
      index = (index + 1) % values.length;
      animateTo(values[index]);
    };
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(([entry]) => {
        window.clearInterval(timer);
        if (entry.isIntersecting) timer = window.setInterval(tick, 2600);
      }).observe(counter);
    }
  }
})();
