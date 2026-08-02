/*
 * LUMEN — gamepad + share card
 * -------------------------------------------------------------
 * Gamepad: polled from the game loop (the Gamepad API has no
 * events for button state), edge-detected so a held button
 * doesn't machine-gun flips.
 *
 * Share card: composites the run's score over a snapshot of the
 * canvas and hands it to the Web Share API as a real image, so a
 * shared run looks like the game instead of a line of text.
 */
(function () {
  'use strict';
  const LUMEN = (window.LUMEN = window.LUMEN || {});

  // ---- gamepad -------------------------------------------------------------
  const FLIP_BUTTONS = [0, 1, 2, 3, 6, 7];   // face buttons + triggers
  const PAUSE_BUTTONS = [9, 8];              // start / select

  const Pad = {
    connected: false,
    _prev: {},
    init() {
      window.addEventListener('gamepadconnected', () => {
        this.connected = true;
        LUMEN.UI && LUMEN.UI.toast && LUMEN.UI.toast(LUMEN.t ? LUMEN.t('padConnected') : 'Gamepad connected');
      });
      window.addEventListener('gamepaddisconnected', () => { this.connected = false; });
    },
    // Called once per frame. Returns nothing; acts on the game directly.
    poll(game) {
      if (!navigator.getGamepads) return;
      let pads;
      try { pads = navigator.getGamepads(); } catch (e) { return; }
      if (!pads) return;
      for (let i = 0; i < pads.length; i++) {
        const p = pads[i];
        if (!p) continue;
        this.connected = true;
        const prev = this._prev[p.index] || (this._prev[p.index] = {});
        // flip: any face button, or dpad up/down, on the rising edge only
        let flip = false;
        for (const b of FLIP_BUTTONS) {
          const cur = !!(p.buttons[b] && p.buttons[b].pressed);
          if (cur && !prev['b' + b]) flip = true;
          prev['b' + b] = cur;
        }
        for (const b of [12, 13]) {
          const cur = !!(p.buttons[b] && p.buttons[b].pressed);
          if (cur && !prev['b' + b]) flip = true;
          prev['b' + b] = cur;
        }
        let pause = false;
        for (const b of PAUSE_BUTTONS) {
          const cur = !!(p.buttons[b] && p.buttons[b].pressed);
          if (cur && !prev['b' + b]) pause = true;
          prev['b' + b] = cur;
        }
        if (pause) {
          if (game.state === 'play') game.pause();
          else if (game.state === 'pause') game.resume();
        } else if (flip) {
          game.action();
        }
      }
    },
  };

  // ---- share card ----------------------------------------------------------
  const Share = {
    // Draw the run onto a shareable 1200x630 card (the standard social ratio).
    render(game, data) {
      const W = 1200, H = 630;
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      const x = c.getContext('2d');

      // backdrop: the live canvas, cover-fitted, dimmed
      const src = game.canvas;
      if (src && src.width && src.height) {
        const scale = Math.max(W / src.width, H / src.height);
        const dw = src.width * scale, dh = src.height * scale;
        x.drawImage(src, (W - dw) / 2, (H - dh) / 2, dw, dh);
      } else {
        x.fillStyle = '#05060f'; x.fillRect(0, 0, W, H);
      }
      const g = x.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, 'rgba(5,6,15,0.55)');
      g.addColorStop(1, 'rgba(5,6,15,0.9)');
      x.fillStyle = g; x.fillRect(0, 0, W, H);

      const T = (k) => (LUMEN.t ? LUMEN.t(k) : k);
      x.textAlign = 'center';

      x.font = '900 46px "Orbitron", system-ui, sans-serif';
      x.fillStyle = '#4df3ff';
      x.shadowColor = '#4df3ff'; x.shadowBlur = 24;
      x.fillText('LUMEN', W / 2, 108);

      x.shadowBlur = 30; x.shadowColor = 'rgba(77,243,255,0.8)';
      x.font = '900 168px "Orbitron", system-ui, sans-serif';
      x.fillStyle = '#ffffff';
      x.fillText(String(data.score), W / 2, 320);

      x.shadowBlur = 0;
      x.font = '700 30px "Rajdhani", system-ui, sans-serif';
      x.fillStyle = 'rgba(234,246,255,0.8)';
      x.fillText(T('topCombo') + '  ×' + (data.combo || 0), W / 2, 386);

      x.font = '600 26px "Rajdhani", system-ui, sans-serif';
      x.fillStyle = 'rgba(234,246,255,0.5)';
      x.fillText(T('tagline'), W / 2, 470);

      if (data.isBest) {
        x.font = '800 28px "Orbitron", system-ui, sans-serif';
        x.fillStyle = '#ffd15c';
        x.shadowColor = '#ffd15c'; x.shadowBlur = 18;
        x.fillText(T('newBest'), W / 2, 545);
      }
      return c;
    },

    // Share an actual image when the platform supports it; otherwise fall back
    // to text, and finally to the clipboard.
    async share(game, data, text) {
      const canvas = this.render(game, data);
      try {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        if (blob && navigator.canShare) {
          const file = new File([blob], 'lumen-' + data.score + '.png', { type: 'image/png' });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], text });
            return 'image';
          }
        }
      } catch (e) { /* user cancelled or unsupported — fall through */ }
      if (navigator.share) {
        try { await navigator.share({ title: 'LUMEN', text }); return 'text'; } catch (e) {}
      }
      try { await navigator.clipboard.writeText(text); return 'clipboard'; } catch (e) {}
      return 'none';
    },

    // Offer the card as a download when sharing isn't available at all.
    download(game, data) {
      const canvas = this.render(game, data);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'lumen-' + data.score + '.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }, 'image/png');
    },
  };

  LUMEN.Pad = Pad;
  LUMEN.Share = Share;
})();
