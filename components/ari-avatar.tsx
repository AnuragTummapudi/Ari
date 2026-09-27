"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    __ariHead?: any;
    __ariAudioContext?: AudioContext;
    __ariHeadAudio?: any;
  }
}

export default function AriAvatar({
  onLoaded,
  onError,
}: {
  onLoaded?: () => void;
  onError?: (err: any) => void;
}) {
  const initialized = useRef(false);
  const callbacks = useRef({ onLoaded, onError });
  useEffect(() => { callbacks.current = { onLoaded, onError }; }, [onLoaded, onError]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    const modelUrl = process.env.NEXT_PUBLIC_ARI_AVATAR_GLB;
    if (!modelUrl) return;

    let head: any;
    let headAudio: any;
    let cancelled = false;

    void (async () => {
      try {
        const mount = document.getElementById("ari-avatar-host");
        if (!mount) return;

        const [{ TalkingHead }, { HeadAudio }] = await Promise.all([
          import("@met4citizen/talkinghead"),
          import("@met4citizen/headaudio/modules/headaudio.mjs"),
        ]);

        const audioCtx = window.__ariAudioContext || new AudioContext();
        window.__ariAudioContext = audioCtx;

        head = new TalkingHead(mount, {
          audioCtx,
          cameraView: "upper",
          avatarMood: "neutral",
          avatarIdleEyeContact: 1,
          avatarSpeakingEyeContact: 1,
          avatarIdleHeadMove: 0.025,
          avatarSpeakingHeadMove: 0.04,
          cameraRotateEnable: false,
          cameraPanEnable: false,
          cameraZoomEnable: false,
        });

        await head.showAvatar({
          url: modelUrl,
          body: "F",
          avatarMood: "neutral",
          baseline: { eyeBlinkLeft: 0.1, eyeBlinkRight: 0.1 },
        });

        if (cancelled) { head.dispose?.(); return; }

        head.lookAtCamera(350);
        window.__ariHead = head;
        mount.closest(".ari-portrait")?.classList.add("has-3d");
        let lipSyncReady = false;
        try {
          await audioCtx.audioWorklet.addModule("/audio/headworklet.min.mjs");
          headAudio = new HeadAudio(audioCtx, {
            processorOptions: {},
            parameterData: { vadGateActiveDb: -40, vadGateInactiveDb: -55 },
          });
          await headAudio.loadModel("/audio/model-en-mixed.bin");
          if (cancelled) { headAudio.disconnect?.(); return; }

          headAudio.onvalue = (key: string, value: number) => {
            if (head?.mtAvatar?.[key]) {
              Object.assign(head.mtAvatar[key], { newvalue: value, needsUpdate: true });
            }
          };
          head.opt.update = headAudio.update.bind(headAudio);
          window.__ariHeadAudio = headAudio;
          window.dispatchEvent(new Event("ari:head-audio-ready"));
          lipSyncReady = true;
        } catch (audioErr) {
          console.warn("HeadAudio worklet initialization deferred:", audioErr);
        }

        window.dispatchEvent(new CustomEvent("ari:avatar-status", { detail: { loaded: true, lipSyncReady } }));
        callbacks.current.onLoaded?.();

      } catch (error) {
        if (cancelled) return;
        console.warn("Ari 3D avatar failed to load; using portrait fallback.", error);
        window.dispatchEvent(new CustomEvent("ari:avatar-status", { detail: { loaded: false, error: String(error) } }));
        callbacks.current.onError?.(error);
      }
    })();

    return () => {
      cancelled = true;
      head?.stopSpeaking?.();
      head?.streamStop?.();
      headAudio?.disconnect?.();
      head?.dispose?.();
      window.__ariHead = undefined;
      window.__ariHeadAudio = undefined;
      initialized.current = false;
    };
  }, []);

  return null;
}
