/* =========================================================
   Portfolio — 3D background, scroll motion, interactions
   ========================================================= */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------
     1. THREE.JS NEURAL NETWORK BACKGROUND
     --------------------------------------------------------- */
  function initBackground() {
    var canvas = document.getElementById("bg-canvas");
    if (!canvas) return;

    if (typeof THREE === "undefined" || reduceMotion) {
      canvas.style.background =
        "radial-gradient(ellipse at 50% 0%, #101a33 0%, #05070d 65%)";
      return;
    }

    // WebGL availability check
    try {
      var test = document.createElement("canvas");
      if (!(test.getContext("webgl") || test.getContext("experimental-webgl"))) {
        throw new Error("no webgl");
      }
    } catch (e) {
      canvas.style.background =
        "radial-gradient(ellipse at 50% 0%, #101a33 0%, #05070d 65%)";
      return;
    }

    var isMobile = window.innerWidth < 768;
    var NODE_COUNT = isMobile ? 70 : 150;
    var LINK_DIST = isMobile ? 30 : 26;
    var MAX_LINKS = isMobile ? 400 : 1400;
    var SPREAD = 100;

    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05070d, 0.0085);

    var camera = new THREE.PerspectiveCamera(
      62,
      window.innerWidth / window.innerHeight,
      1,
      500
    );
    camera.position.z = 110;

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !isMobile,
      alpha: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.setClearColor(0x000000, 0);

    var group = new THREE.Group();
    scene.add(group);

    // --- Node positions & velocities ---
    var positions = new Float32Array(NODE_COUNT * 3);
    var velocities = new Float32Array(NODE_COUNT * 3);
    var nodeColors = new Float32Array(NODE_COUNT * 3);

    var palette = [
      new THREE.Color(0x4f8cff),
      new THREE.Color(0x26e0c8),
      new THREE.Color(0xa06bff)
    ];

    for (var i = 0; i < NODE_COUNT; i++) {
      var i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * SPREAD * 2;
      positions[i3 + 1] = (Math.random() - 0.5) * SPREAD * 2;
      positions[i3 + 2] = (Math.random() - 0.5) * SPREAD * 2;

      velocities[i3] = (Math.random() - 0.5) * 0.055;
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.055;
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.055;

      var c = palette[Math.floor(Math.random() * palette.length)];
      nodeColors[i3] = c.r;
      nodeColors[i3 + 1] = c.g;
      nodeColors[i3 + 2] = c.b;
    }

    // --- Node sprite texture (soft glowing dot) ---
    function makeDotTexture() {
      var s = 64;
      var c = document.createElement("canvas");
      c.width = c.height = s;
      var ctx = c.getContext("2d");
      var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.25, "rgba(255,255,255,0.85)");
      g.addColorStop(0.55, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      var tex = new THREE.Texture(c);
      tex.needsUpdate = true;
      return tex;
    }

    var pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(positions, 3)
    );
    pointsGeo.setAttribute("color", new THREE.BufferAttribute(nodeColors, 3));

    var pointsMat = new THREE.PointsMaterial({
      size: isMobile ? 2.6 : 2.2,
      map: makeDotTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true
    });

    var points = new THREE.Points(pointsGeo, pointsMat);
    group.add(points);

    // --- Connecting lines ---
    var linePositions = new Float32Array(MAX_LINKS * 6);
    var lineColors = new Float32Array(MAX_LINKS * 6);
    var lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage)
    );
    lineGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(lineColors, 3).setUsage(THREE.DynamicDrawUsage)
    );
    lineGeo.setDrawRange(0, 0);

    var lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    var lines = new THREE.LineSegments(lineGeo, lineMat);
    group.add(lines);

    // --- Interaction state ---
    var mouse = { x: 0, y: 0 };
    var target = { x: 0, y: 0 };
    var scrollY = 0;
    var scrollTarget = 0;

    window.addEventListener(
      "mousemove",
      function (e) {
        target.x = (e.clientX / window.innerWidth - 0.5) * 2;
        target.y = (e.clientY / window.innerHeight - 0.5) * 2;
      },
      { passive: true }
    );

    window.addEventListener(
      "scroll",
      function () {
        var max = document.body.scrollHeight - window.innerHeight;
        scrollTarget = max > 0 ? window.scrollY / max : 0;
      },
      { passive: true }
    );

    window.addEventListener("resize", function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // Pause when tab hidden
    var running = true;
    document.addEventListener("visibilitychange", function () {
      running = !document.hidden;
      if (running) animate();
    });

    var frame = 0;
    var linkFrame = 0;

    function updateLinks() {
      var pos = pointsGeo.attributes.position.array;
      var idx = 0;
      var cIdx = 0;
      var count = 0;

      for (var a = 0; a < NODE_COUNT; a++) {
        var a3 = a * 3;
        for (var b = a + 1; b < NODE_COUNT; b++) {
          if (count >= MAX_LINKS) break;
          var b3 = b * 3;
          var dx = pos[a3] - pos[b3];
          var dy = pos[a3 + 1] - pos[b3 + 1];
          var dz = pos[a3 + 2] - pos[b3 + 2];
          var d2 = dx * dx + dy * dy + dz * dz;

          if (d2 < LINK_DIST * LINK_DIST) {
            var alpha = 1 - Math.sqrt(d2) / LINK_DIST;
            alpha *= alpha;

            linePositions[idx++] = pos[a3];
            linePositions[idx++] = pos[a3 + 1];
            linePositions[idx++] = pos[a3 + 2];
            linePositions[idx++] = pos[b3];
            linePositions[idx++] = pos[b3 + 1];
            linePositions[idx++] = pos[b3 + 2];

            lineColors[cIdx++] = nodeColors[a3] * alpha;
            lineColors[cIdx++] = nodeColors[a3 + 1] * alpha;
            lineColors[cIdx++] = nodeColors[a3 + 2] * alpha;
            lineColors[cIdx++] = nodeColors[b3] * alpha;
            lineColors[cIdx++] = nodeColors[b3 + 1] * alpha;
            lineColors[cIdx++] = nodeColors[b3 + 2] * alpha;

            count++;
          }
        }
        if (count >= MAX_LINKS) break;
      }

      lineGeo.setDrawRange(0, count * 2);
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.attributes.color.needsUpdate = true;
    }

    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);
      frame++;

      var pos = pointsGeo.attributes.position.array;

      // Drift nodes, wrap at bounds
      for (var i = 0; i < NODE_COUNT; i++) {
        var i3 = i * 3;
        for (var k = 0; k < 3; k++) {
          pos[i3 + k] += velocities[i3 + k];
          if (pos[i3 + k] > SPREAD) pos[i3 + k] = -SPREAD;
          else if (pos[i3 + k] < -SPREAD) pos[i3 + k] = SPREAD;
        }
      }
      pointsGeo.attributes.position.needsUpdate = true;

      // Rebuild links every 2nd frame (cost control)
      linkFrame++;
      if (linkFrame % 2 === 0) updateLinks();

      // Smooth mouse + scroll easing
      mouse.x += (target.x - mouse.x) * 0.045;
      mouse.y += (target.y - mouse.y) * 0.045;
      scrollY += (scrollTarget - scrollY) * 0.07;

      // Scroll drives rotation + camera dolly; mouse drives parallax
      group.rotation.y = frame * 0.00035 + mouse.x * 0.35 + scrollY * 2.4;
      group.rotation.x = mouse.y * 0.22 + scrollY * 0.85;
      group.position.y = scrollY * 26;

      camera.position.z = 110 - scrollY * 48;
      camera.position.x += (mouse.x * 9 - camera.position.x) * 0.045;
      camera.position.y += (-mouse.y * 9 - camera.position.y) * 0.045;
      camera.lookAt(scene.position);

      renderer.render(scene, camera);
    }

    animate();
  }

  /* ---------------------------------------------------------
     2. SCROLL REVEAL
     --------------------------------------------------------- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      for (var i = 0; i < els.length; i++) els[i].classList.add("visible");
      return;
    }
    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            obs.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
    );
    els.forEach(function (el) {
      obs.observe(el);
    });
  }

  /* ---------------------------------------------------------
     3. SCROLL PROGRESS + HEADER + ACTIVE NAV + PARALLAX
     --------------------------------------------------------- */
  function initScrollUI() {
    var bar = document.getElementById("scroll-bar");
    var header = document.getElementById("site-header");
    var navLinks = document.querySelectorAll(".nav-link");
    var sections = document.querySelectorAll("main section[id]");
    var parallaxEls = document.querySelectorAll("[data-parallax]");
    var ticking = false;

    function onScroll() {
      var y = window.scrollY;
      var max = document.body.scrollHeight - window.innerHeight;

      if (bar) bar.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
      if (header) header.classList.toggle("scrolled", y > 40);

      // Active nav
      var current = "";
      sections.forEach(function (s) {
        if (y >= s.offsetTop - 160) current = s.id;
      });
      navLinks.forEach(function (l) {
        l.classList.toggle("active", l.getAttribute("href") === "#" + current);
      });

      // Hero parallax
      if (!reduceMotion && y < window.innerHeight * 1.2) {
        parallaxEls.forEach(function (el) {
          var speed = parseFloat(el.getAttribute("data-parallax")) || 0;
          el.style.transform = "translate3d(0," + y * speed + "px,0)";
        });
      }

      ticking = false;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          window.requestAnimationFrame(onScroll);
          ticking = true;
        }
      },
      { passive: true }
    );

    onScroll();
  }

  /* ---------------------------------------------------------
     4. 3D CARD TILT
     --------------------------------------------------------- */
  function initTilt() {
    if (reduceMotion) return;
    if (window.matchMedia("(hover: none)").matches) return;

    var cards = document.querySelectorAll(".tilt");

    cards.forEach(function (card) {
      var raf = null;

      // Cards are also .reveal elements, whose 0.85s transform transition
      // would make the tilt feel laggy. Override it inline while hovering.
      card.addEventListener("mouseenter", function () {
        card.style.transition = "transform 0.12s ease-out";
      });

      card.addEventListener("mousemove", function (e) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          var r = card.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width - 0.5;
          var py = (e.clientY - r.top) / r.height - 0.5;
          var max = card.classList.contains("project-card") ? 7 : 10;
          card.style.transform =
            "perspective(900px) rotateX(" +
            (-py * max).toFixed(2) +
            "deg) rotateY(" +
            (px * max).toFixed(2) +
            "deg) translateY(-6px) scale(1.015)";
          raf = null;
        });
      });

      card.addEventListener("mouseleave", function () {
        card.style.transition = "transform 0.45s cubic-bezier(.22,.61,.36,1)";
        card.style.transform =
          "perspective(900px) rotateX(0) rotateY(0) translateY(0) scale(1)";
      });
    });
  }

  /* ---------------------------------------------------------
     5. STAT COUNTERS
     --------------------------------------------------------- */
  function initCounters() {
    var nums = document.querySelectorAll("[data-count]");
    if (!nums.length) return;

    if (reduceMotion || !("IntersectionObserver" in window)) {
      nums.forEach(function (n) {
        n.textContent = n.getAttribute("data-count");
      });
      return;
    }

    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          var el = entry.target;
          var end = parseInt(el.getAttribute("data-count"), 10);
          var dur = 1400;
          var t0 = performance.now();

          (function step(now) {
            var p = Math.min((now - t0) / dur, 1);
            var eased = 1 - Math.pow(1 - p, 3);
            el.textContent = Math.round(end * eased);
            if (p < 1) requestAnimationFrame(step);
          })(t0);

          obs.unobserve(el);
        });
      },
      { threshold: 0.5 }
    );

    nums.forEach(function (n) {
      obs.observe(n);
    });
  }

  /* ---------------------------------------------------------
     6. MOBILE MENU
     --------------------------------------------------------- */
  function initMenu() {
    var btn = document.getElementById("hamburger");
    var menu = document.getElementById("mobile-menu");
    if (!btn || !menu) return;

    function close() {
      menu.classList.remove("open");
      btn.classList.remove("open");
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", function () {
      var open = menu.classList.toggle("open");
      btn.classList.toggle("open", open);
      btn.setAttribute("aria-expanded", String(open));
    });

    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", close);
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
    });
  }

  /* ---------------------------------------------------------
     BOOT
     --------------------------------------------------------- */
  function boot() {
    initBackground();
    initReveal();
    initScrollUI();
    initTilt();
    initCounters();
    initMenu();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
