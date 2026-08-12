/* =========================================================
   Portfolio — Transformer-architecture 3D background,
   scroll motion and interactions
   ========================================================= */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Progressive enhancement: .reveal elements are visible by default and only
  // start hidden once this class is set. If this script dies for any reason,
  // the page still renders its content instead of a blank screen.
  document.documentElement.classList.add("js-ready");

  /* =========================================================
     1. TRANSFORMER BACKGROUND
     ---------------------------------------------------------
     Renders a stack of transformer layers. Each layer holds a
     token sequence; multi-head self-attention arcs connect the
     tokens, and their brightness tracks live softmax weights
     that drift over time. A "forward pass" pulse sweeps down
     the stack, and page scroll flies the camera through it.
     ========================================================= */
  function initBackground() {
    var canvas = document.getElementById("bg-canvas");
    if (!canvas) return;

    var hud = document.getElementById("arch-hud");
    var hudLayer = document.getElementById("arch-hud-layer");
    var hudFill = document.getElementById("arch-hud-fill");

    // The CSS gradient + aurora layer already stand on their own, so the
    // fallback just steps out of the way rather than painting over them.
    function fallback(reason) {
      canvas.style.display = "none";
      if (hud) hud.style.display = "none";
      document.documentElement.classList.add("no-webgl");
      if (window.console && reason) console.warn("[background] " + reason);
    }

    if (typeof THREE === "undefined") {
      fallback("three.js did not load — using CSS gradient background only");
      return;
    }
    if (reduceMotion) {
      fallback();
      return;
    }

    try {
      var probe = document.createElement("canvas");
      if (!(probe.getContext("webgl") || probe.getContext("experimental-webgl"))) {
        throw new Error("no webgl");
      }
    } catch (e) {
      fallback("WebGL unavailable — using CSS gradient background only");
      return;
    }

    /* ---------- Architecture parameters ---------- */
    var isMobile = window.innerWidth < 768;

    var LAYERS = isMobile ? 5 : 7; // transformer blocks in the stack
    var SEQ = isMobile ? 10 : 15; // tokens in the sequence
    var HEADS = isMobile ? 2 : 3; // attention heads
    var TOPK = isMobile ? 3 : 4; // attention targets kept per token
    var SEG = 8; // polyline segments per attention arc
    var LAYER_GAP = 62;
    var X_SPREAD = 105;
    var RESIDUAL = isMobile ? 140 : 300;

    var LAYER_NAMES = isMobile
      ? [
          "Input Embedding",
          "Multi-Head Attention",
          "Add & Norm",
          "Feed-Forward",
          "Output Projection"
        ]
      : [
          "Input Embedding + Positional Encoding",
          "Multi-Head Self-Attention",
          "Add & Norm",
          "Feed-Forward Network",
          "Multi-Head Self-Attention",
          "Add & Norm",
          "Output Projection"
        ];

    var HEAD_COLORS = [
      new THREE.Color(0x4f8cff), // blue
      new THREE.Color(0x26e0c8), // teal
      new THREE.Color(0xa06bff) // purple
    ];

    var Z_FIRST = ((LAYERS - 1) / 2) * LAYER_GAP; // layer 0 sits nearest the viewer
    function zOfLayer(l) {
      return Z_FIRST - l * LAYER_GAP;
    }
    var STACK_SPAN = (LAYERS - 1) * LAYER_GAP;

    /* ---------- Scene ---------- */
    var scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x070b18, 0.0028);

    var camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / window.innerHeight,
      1,
      1400
    );

    var renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: !isMobile,
      alpha: true,
      powerPreference: "high-performance"
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobile ? 1.5 : 2));
    renderer.setClearColor(0x000000, 0);

    var group = new THREE.Group();
    scene.add(group);

    /* ---------- Token lattice: LAYERS x SEQ ---------- */
    var TOKENS = LAYERS * SEQ;
    var tokenPos = new Float32Array(TOKENS * 3);
    var tokenSize = new Float32Array(TOKENS);
    var tokenColor = new Float32Array(TOKENS * 3);
    var tokenBase = new Float32Array(TOKENS); // baseline size
    var tokenAttn = new Float32Array(TOKENS); // incoming attention, per frame

    function tokenIndex(l, i) {
      return l * SEQ + i;
    }

    for (var l = 0; l < LAYERS; l++) {
      for (var i = 0; i < SEQ; i++) {
        var ti = tokenIndex(l, i);
        var t3 = ti * 3;
        tokenPos[t3] = (i / (SEQ - 1) - 0.5) * 2 * X_SPREAD;
        tokenPos[t3 + 1] = Math.sin(i * 0.85 + l * 1.4) * 8;
        tokenPos[t3 + 2] = zOfLayer(l);

        tokenBase[ti] = 2.0 + Math.random() * 0.9;
        tokenSize[ti] = tokenBase[ti];

        // Tokens tinted toward the layer's dominant head colour
        var c = HEAD_COLORS[l % HEADS];
        tokenColor[t3] = 0.55 + c.r * 0.45;
        tokenColor[t3 + 1] = 0.55 + c.g * 0.45;
        tokenColor[t3 + 2] = 0.55 + c.b * 0.45;
      }
    }

    /* ---------- Soft dot sprite ---------- */
    function makeDotTexture() {
      var s = 64;
      var cv = document.createElement("canvas");
      cv.width = cv.height = s;
      var ctx = cv.getContext("2d");
      var g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.22, "rgba(255,255,255,0.9)");
      g.addColorStop(0.5, "rgba(255,255,255,0.25)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      var tex = new THREE.Texture(cv);
      tex.needsUpdate = true;
      return tex;
    }

    var dotTex = makeDotTexture();

    /* ---------- Token points (custom shader for per-point size) ---------- */
    var tokenGeo = new THREE.BufferGeometry();
    tokenGeo.setAttribute("position", new THREE.BufferAttribute(tokenPos, 3));
    tokenGeo.setAttribute(
      "aSize",
      new THREE.BufferAttribute(tokenSize, 1).setUsage(THREE.DynamicDrawUsage)
    );
    tokenGeo.setAttribute("aColor", new THREE.BufferAttribute(tokenColor, 3));

    var tokenMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: dotTex } },
      vertexShader: [
        "attribute float aSize;",
        "attribute vec3 aColor;",
        "varying vec3 vColor;",
        "varying float vFade;",
        "void main() {",
        "  vColor = aColor;",
        "  vec4 mv = modelViewMatrix * vec4(position, 1.0);",
        "  float d = max(-mv.z, 1.0);",
        "  vFade = clamp(1.0 - (d - 50.0) / 520.0, 0.0, 1.0);",
        "  gl_PointSize = clamp(aSize * (330.0 / d), 1.0, 44.0);",
        "  gl_Position = projectionMatrix * mv;",
        "}"
      ].join("\n"),
      fragmentShader: [
        "uniform sampler2D uMap;",
        "varying vec3 vColor;",
        "varying float vFade;",
        "void main() {",
        "  vec4 tex = texture2D(uMap, gl_PointCoord);",
        "  if (tex.a < 0.01) discard;",
        "  gl_FragColor = vec4(vColor * vFade, 1.0) * tex;",
        "}"
      ].join("\n"),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    group.add(new THREE.Points(tokenGeo, tokenMat));

    /* ---------- Attention arcs ----------
       One arc per (layer, head, query token, target). Arc geometry is
       static; only vertex colours change, driven by softmax weights. */
    var ARCS = LAYERS * HEADS * SEQ * TOPK;
    var VERTS_PER_ARC = SEG * 2; // LineSegments: 2 verts per segment
    var arcPos = new Float32Array(ARCS * VERTS_PER_ARC * 3);
    var arcCol = new Float32Array(ARCS * VERTS_PER_ARC * 3);

    // Per-arc animation state driving the attention logits
    var aTarget = new Int16Array(ARCS);
    var aLayer = new Int16Array(ARCS);
    var aHead = new Int8Array(ARCS);
    var aBase = new Float32Array(ARCS);
    var aAmp = new Float32Array(ARCS);
    var aFreq = new Float32Array(ARCS);
    var aPhase = new Float32Array(ARCS);
    var aWeight = new Float32Array(ARCS);

    function quadBezier(p0, p1, c, t) {
      var mt = 1 - t;
      return mt * mt * p0 + 2 * mt * t * c + t * t * p1;
    }

    var arc = 0;
    for (var L = 0; L < LAYERS; L++) {
      for (var h = 0; h < HEADS; h++) {
        // Heads are offset slightly in Z so their arc sheets stay legible
        var headZ = (h - (HEADS - 1) / 2) * 7;
        for (var q = 0; q < SEQ; q++) {
          // Pick TOPK distinct attention targets for this query token
          var chosen = {};
          for (var k = 0; k < TOPK; k++) {
            var tgt;
            var guard = 0;
            do {
              // Bias toward nearby tokens, as attention often is
              var span = 1 + Math.floor(Math.pow(Math.random(), 1.7) * (SEQ - 1));
              tgt = q + (Math.random() < 0.5 ? -span : span);
              if (tgt < 0) tgt += SEQ;
              if (tgt >= SEQ) tgt -= SEQ;
              guard++;
            } while (chosen[tgt] && guard < 24);
            chosen[tgt] = true;

            aTarget[arc] = tgt;
            aLayer[arc] = L;
            aHead[arc] = h;
            aBase[arc] = Math.random() * 1.6;
            aAmp[arc] = 0.7 + Math.random() * 1.7;
            aFreq[arc] = 0.16 + Math.random() * 0.42;
            aPhase[arc] = Math.random() * Math.PI * 2;

            // Static arc geometry: quadratic bezier bowing upward
            var qi = tokenIndex(L, q) * 3;
            var ki = tokenIndex(L, tgt) * 3;
            var x0 = tokenPos[qi], y0 = tokenPos[qi + 1], z0 = tokenPos[qi + 2] + headZ;
            var x1 = tokenPos[ki], y1 = tokenPos[ki + 1], z1 = tokenPos[ki + 2] + headZ;

            var dist = Math.abs(q - tgt);
            var cx = (x0 + x1) / 2;
            var cy = (y0 + y1) / 2 + 16 + dist * 3.4;
            var cz = (z0 + z1) / 2;

            var base = arc * VERTS_PER_ARC * 3;
            for (var s = 0; s < SEG; s++) {
              var t0 = s / SEG;
              var t1 = (s + 1) / SEG;
              var o = base + s * 6;
              arcPos[o] = quadBezier(x0, x1, cx, t0);
              arcPos[o + 1] = quadBezier(y0, y1, cy, t0);
              arcPos[o + 2] = quadBezier(z0, z1, cz, t0);
              arcPos[o + 3] = quadBezier(x0, x1, cx, t1);
              arcPos[o + 4] = quadBezier(y0, y1, cy, t1);
              arcPos[o + 5] = quadBezier(z0, z1, cz, t1);
            }
            arc++;
          }
        }
      }
    }

    var arcGeo = new THREE.BufferGeometry();
    arcGeo.setAttribute("position", new THREE.BufferAttribute(arcPos, 3));
    arcGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(arcCol, 3).setUsage(THREE.DynamicDrawUsage)
    );

    var arcMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true
    });

    group.add(new THREE.LineSegments(arcGeo, arcMat));

    /* ---------- Layer frames (the block boundaries) ---------- */
    var framePts = [];
    var frameCols = [];
    for (var fl = 0; fl < LAYERS; fl++) {
      var fz = zOfLayer(fl);
      var x = X_SPREAD + 16;
      var yb = -34;
      var yt = 46;
      var corners = [
        [-x, yb, fz], [x, yb, fz],
        [x, yb, fz], [x, yt, fz],
        [x, yt, fz], [-x, yt, fz],
        [-x, yt, fz], [-x, yb, fz]
      ];
      var fc = HEAD_COLORS[fl % HEADS];
      for (var ci = 0; ci < corners.length; ci++) {
        framePts.push(corners[ci][0], corners[ci][1], corners[ci][2]);
        frameCols.push(fc.r * 0.55, fc.g * 0.55, fc.b * 0.55);
      }
    }

    var frameGeo = new THREE.BufferGeometry();
    frameGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(framePts), 3)
    );
    frameGeo.setAttribute(
      "color",
      new THREE.BufferAttribute(new Float32Array(frameCols), 3)
    );
    group.add(
      new THREE.LineSegments(
        frameGeo,
        new THREE.LineBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.55,
          blending: THREE.AdditiveBlending,
          depthWrite: false
        })
      )
    );

    /* ---------- Residual stream particles ---------- */
    var resPos = new Float32Array(RESIDUAL * 3);
    var resCol = new Float32Array(RESIDUAL * 3);
    var resSize = new Float32Array(RESIDUAL);
    var resSpeed = new Float32Array(RESIDUAL);
    var Z_START = zOfLayer(0) + LAYER_GAP;
    var Z_END = zOfLayer(LAYERS - 1) - LAYER_GAP;

    for (var r = 0; r < RESIDUAL; r++) {
      var r3 = r * 3;
      resPos[r3] = (Math.random() - 0.5) * 2 * (X_SPREAD + 20);
      resPos[r3 + 1] = -30 + Math.random() * 76;
      resPos[r3 + 2] = Z_END + Math.random() * (Z_START - Z_END);
      resSize[r] = 0.7 + Math.random() * 1.1;
      resSpeed[r] = 0.35 + Math.random() * 0.75;
      var rc = HEAD_COLORS[r % HEADS];
      resCol[r3] = rc.r * 0.75;
      resCol[r3 + 1] = rc.g * 0.75;
      resCol[r3 + 2] = rc.b * 0.75;
    }

    var resGeo = new THREE.BufferGeometry();
    resGeo.setAttribute(
      "position",
      new THREE.BufferAttribute(resPos, 3).setUsage(THREE.DynamicDrawUsage)
    );
    resGeo.setAttribute("aSize", new THREE.BufferAttribute(resSize, 1));
    resGeo.setAttribute("aColor", new THREE.BufferAttribute(resCol, 3));
    group.add(new THREE.Points(resGeo, tokenMat));

    /* ---------- Interaction state ---------- */
    var mouse = { x: 0, y: 0 };
    var target = { x: 0, y: 0 };
    var scroll = 0;
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
        scrollTarget = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
      },
      { passive: true }
    );

    window.addEventListener("resize", function () {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    var running = true;
    document.addEventListener("visibilitychange", function () {
      var wasRunning = running;
      running = !document.hidden;
      if (running && !wasRunning) {
        clock = now() - 16;
        animate();
      }
    });

    /* ---------- Attention weights: per-token softmax over targets ---------- */
    var logits = new Float32Array(TOPK);

    function updateAttention(time, layerBoost) {
      var idx = 0;
      for (var i = 0; i < TOKENS; i++) tokenAttn[i] = 0;

      for (var L2 = 0; L2 < LAYERS; L2++) {
        var boost = layerBoost[L2];
        for (var h2 = 0; h2 < HEADS; h2++) {
          for (var q2 = 0; q2 < SEQ; q2++) {
            var start = idx;

            // Time-varying logits for this query token's attention distribution
            var maxLogit = -Infinity;
            for (var k2 = 0; k2 < TOPK; k2++) {
              var a = start + k2;
              var v = aBase[a] + aAmp[a] * Math.sin(time * aFreq[a] + aPhase[a]);
              logits[k2] = v;
              if (v > maxLogit) maxLogit = v;
            }

            // Softmax (max-subtracted for numerical stability)
            var sum = 0;
            for (var k3 = 0; k3 < TOPK; k3++) {
              logits[k3] = Math.exp(logits[k3] - maxLogit);
              sum += logits[k3];
            }
            var inv = sum > 0 ? 1 / sum : 0;

            for (var k4 = 0; k4 < TOPK; k4++) {
              var w = logits[k4] * inv;
              var a2 = start + k4;
              aWeight[a2] = w;
              // Attention received by the target token, for its glow
              tokenAttn[tokenIndex(L2, aTarget[a2])] += w * boost;
            }

            idx += TOPK;
          }
        }
      }
    }

    function writeArcColors(layerBoost) {
      for (var a = 0; a < ARCS; a++) {
        var c = HEAD_COLORS[aHead[a]];
        // Gamma-shape the weight so strong links dominate. Exponent stays
        // below 1 so a typical 1/TOPK weight still renders clearly — at 1.45
        // the arcs crushed to ~rgb(16,28,51) and vanished.
        var w = Math.pow(aWeight[a], 0.85) * layerBoost[aLayer[a]] * 2.6;
        if (w > 3.2) w = 3.2;
        var rr = c.r * w, gg = c.g * w, bb = c.b * w;

        var base = a * VERTS_PER_ARC * 3;
        for (var v = 0; v < VERTS_PER_ARC; v++) {
          // Taper each arc toward its endpoints
          var f = 0.45 + 0.55 * Math.sin((v / (VERTS_PER_ARC - 1)) * Math.PI);
          var o = base + v * 3;
          arcCol[o] = rr * f;
          arcCol[o + 1] = gg * f;
          arcCol[o + 2] = bb * f;
        }
      }
      arcGeo.attributes.color.needsUpdate = true;
    }

    /* ---------- Loop ---------- */
    var now =
      window.performance && window.performance.now
        ? function () { return window.performance.now(); }
        : function () { return Date.now(); };

    var clock = now();
    var elapsed = 0;
    var frame = 0;
    var layerBoost = new Float32Array(LAYERS);
    var hudIndex = -1;
    var PULSE_PERIOD = 4.2; // seconds for one forward pass
    var PULSE_SIGMA = LAYER_GAP * 0.85;
    var CAM_LEAD = 95; // how far in front of the current block the camera sits

    function animate() {
      if (!running) return;
      requestAnimationFrame(animate);

      var t = now();
      var dt = Math.min((t - clock) / 1000, 0.05);
      clock = t;
      elapsed += dt;
      frame++;

      // Easing toward pointer and scroll targets
      mouse.x += (target.x - mouse.x) * 0.05;
      mouse.y += (target.y - mouse.y) * 0.05;
      scroll += (scrollTarget - scroll) * 0.075;

      /* --- Forward-pass pulse travelling down the stack --- */
      var pulseT = (elapsed % PULSE_PERIOD) / PULSE_PERIOD;
      var pulseZ = Z_START - pulseT * (Z_START - Z_END);
      for (var pl = 0; pl < LAYERS; pl++) {
        var d = zOfLayer(pl) - pulseZ;
        layerBoost[pl] = 1 + 2.4 * Math.exp(-(d * d) / (2 * PULSE_SIGMA * PULSE_SIGMA));
      }

      /* --- Attention weights + arc colours (every other frame) --- */
      updateAttention(elapsed, layerBoost);
      if (frame % 2 === 0) writeArcColors(layerBoost);

      /* --- Token glow follows incoming attention (capped so a heavily
             attended token can't blow out into a blob up close) --- */
      for (var ti2 = 0; ti2 < TOKENS; ti2++) {
        var attn = tokenAttn[ti2];
        if (attn > 8) attn = 8;
        var want = tokenBase[ti2] * (1 + attn * 0.3);
        tokenSize[ti2] += (want - tokenSize[ti2]) * 0.14;
      }
      tokenGeo.attributes.aSize.needsUpdate = true;

      /* --- Residual stream drifts through the stack --- */
      for (var rp = 0; rp < RESIDUAL; rp++) {
        var rz = rp * 3 + 2;
        resPos[rz] -= resSpeed[rp] * (1 + scroll * 1.5) * dt * 42;
        if (resPos[rz] < Z_END) resPos[rz] = Z_START;
      }
      resGeo.attributes.position.needsUpdate = true;

      /* --- Camera flies through the stack as the page scrolls.
             Travel is exactly one LAYER_GAP per block, so scroll position
             maps 1:1 onto block index and the HUD can't drift. --- */
      var camZ = Z_FIRST + CAM_LEAD - scroll * STACK_SPAN;
      camera.position.z = camZ;
      camera.position.x += (mouse.x * 26 - camera.position.x) * 0.05;
      camera.position.y += (-mouse.y * 18 + 6 - camera.position.y) * 0.05;
      camera.lookAt(mouse.x * 10, -mouse.y * 6, camZ - 140);

      // Slow drift so the stack never looks frozen
      group.rotation.z = Math.sin(elapsed * 0.09) * 0.035;
      group.rotation.y = Math.sin(elapsed * 0.06) * 0.05 + mouse.x * 0.06;

      renderer.render(scene, camera);

      /* --- HUD: which block are we inside? --- */
      if (hudLayer && frame % 6 === 0) {
        var li = Math.round(scroll * (LAYERS - 1));
        if (li < 0) li = 0;
        if (li > LAYERS - 1) li = LAYERS - 1;
        if (li !== hudIndex) {
          hudIndex = li;
          hudLayer.textContent =
            "block " + (li + 1) + "/" + LAYERS + " · " + LAYER_NAMES[li];
        }
        if (hudFill) hudFill.style.width = (scroll * 100).toFixed(1) + "%";
      }
    }

    animate();
  }

  /* =========================================================
     2. SCROLL REVEAL
     ========================================================= */
  function revealAll() {
    var els = document.querySelectorAll(".reveal");
    for (var i = 0; i < els.length; i++) els[i].classList.add("visible");
  }

  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window)) {
      revealAll();
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

  /* =========================================================
     3. SCROLL PROGRESS + HEADER + ACTIVE NAV + PARALLAX
     ========================================================= */
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

      var current = "";
      sections.forEach(function (s) {
        if (y >= s.offsetTop - 160) current = s.id;
      });
      navLinks.forEach(function (link) {
        link.classList.toggle(
          "active",
          link.getAttribute("href") === "#" + current
        );
      });

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

  /* =========================================================
     4. 3D CARD TILT
     ========================================================= */
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

  /* =========================================================
     5. STAT COUNTERS
     ========================================================= */
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

          (function step(nowTs) {
            var p = Math.min((nowTs - t0) / dur, 1);
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

  /* =========================================================
     6. MOBILE MENU
     ========================================================= */
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

  /* =========================================================
     BOOT
     ========================================================= */
  function boot() {
    // Each subsystem is isolated: a failure in the WebGL background must not
    // stop the reveal animations, nav or menu from working.
    var steps = [
      ["reveal", initReveal],
      ["scroll UI", initScrollUI],
      ["menu", initMenu],
      ["counters", initCounters],
      ["tilt", initTilt],
      ["background", initBackground]
    ];

    for (var i = 0; i < steps.length; i++) {
      try {
        steps[i][1]();
      } catch (err) {
        if (window.console) console.error("[" + steps[i][0] + "] failed:", err);
        if (steps[i][0] === "reveal") revealAll();
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
