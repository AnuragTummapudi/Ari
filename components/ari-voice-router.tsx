"use client";

import { useEffect } from "react";
import { RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from "livekit-client";
import { useRoomContext } from "@livekit/components-react";
import { audioRms, SpeakingGate } from "@/lib/speaking";

const VISEMES = [
  "viseme_aa", "viseme_E", "viseme_I", "viseme_O", "viseme_U",
  "viseme_PP", "viseme_SS", "viseme_TH", "viseme_DD", "viseme_FF",
  "viseme_kk", "viseme_nn", "viseme_RR", "viseme_CH", "viseme_sil"
];

type AudioRoute = {
  element: HTMLMediaElement;
  source?: MediaStreamAudioSourceNode;
  analyser?: AnalyserNode;
  samples: Float32Array;
  headAudio?: AudioNode;
};

/** Audible output for Ari's remote track via track.attach(); HeadAudio receives an analysis-only branch. */
export default function AriVoiceRouter({ onChatSender }: { onChatSender: (sender: ((text: string) => Promise<void>) | null) => void }) {
  const room = useRoomContext();

  useEffect(() => {
    const context = window.__ariAudioContext || new AudioContext();
    window.__ariAudioContext = context;
    const routes = new Map<RemoteTrack, AudioRoute>();
    const ariGate = new SpeakingGate(0.0025);
    const candidateGate = new SpeakingGate(0.018);
    let localTrack: MediaStreamTrack | undefined;
    let localSource: MediaStreamAudioSourceNode | undefined;
    let localAnalyser: AnalyserNode | undefined;
    let localSamples = new Float32Array(256);
    const silentGain = context.createGain();
    silentGain.gain.value = 0;
    silentGain.connect(context.destination);
    let speaking = { ari: false, candidate: false };
    let disposing = false;
    let tickTimer = 0;
    let agentPresent = false;

    const emitSpeaking = (ari: boolean, candidate: boolean) => {
      if (ari === speaking.ari && candidate === speaking.candidate) return;
      speaking = { ari, candidate };
      window.dispatchEvent(new CustomEvent("ari:speakers", { detail: speaking }));
      if (ari) window.dispatchEvent(new CustomEvent("ari:state", { detail: "speaking" }));
      else if (!candidate) window.dispatchEvent(new CustomEvent("ari:state", { detail: "listening" }));
    };

    const resetMouth = () => {
      const head = window.__ariHead;
      if (!head?.mtAvatar) return;
      for (const name of VISEMES) {
        if (head.mtAvatar[name]) Object.assign(head.mtAvatar[name], { newvalue: 0, needsUpdate: true });
      }
    };

    const attachHeadAudio = () => {
      const node = window.__ariHeadAudio as AudioNode | undefined;
      if (!node) return;
      for (const route of routes.values()) {
        if (route.headAudio || !route.source) continue;
        try {
          route.source.connect(node);
          route.headAudio = node;
        } catch (error) {
          console.warn("Ari lip sync could not connect:", error);
        }
      }
    };

    // Any remote participant in the 1:1 room is Ari
    const isAriParticipant = (participant: RemoteParticipant) =>
      Boolean(
        !participant.isLocal ||
        participant.isAgent ||
        participant.identity?.toLowerCase().includes("agent") ||
        participant.identity?.toLowerCase().includes("ari") ||
        participant.name?.toLowerCase().includes("ari")
      );

    const setAgentPresent = () => {
      const present = [...room.remoteParticipants.values()].some(isAriParticipant);
      if (present === agentPresent) return;
      agentPresent = present;
      window.dispatchEvent(new CustomEvent("ari:agent-ready", { detail: present }));
    };

    const routeTrack = (track: RemoteTrack, participant: RemoteParticipant) => {
      if (!isAriParticipant(participant) || track.kind !== Track.Kind.Audio || routes.has(track)) return;
      const media = track.mediaStreamTrack;
      if (!media) return;

      // 1. Native WebRTC Audio playback via track.attach()
      // Plays Ari's speech out of the system speakers with native hardware decoding.
      const el = track.attach();
      el.volume = 1;
      el.autoplay = true;
      if (!el.parentElement) {
        el.style.position = "fixed";
        el.style.top = "-9999px";
        el.style.left = "-9999px";
        el.style.width = "1px";
        el.style.height = "1px";
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        document.body.appendChild(el);
      }
      void el.play().catch(err => {
        console.warn("Ari audio element play error:", err);
      });

      // 2. WebAudio analysis branch for Lip Sync (HeadAudio) and volume Analyser (no destination echo)
      let source: MediaStreamAudioSourceNode | undefined;
      let analyser: AnalyserNode | undefined;
      try {
        source = context.createMediaStreamSource(new MediaStream([media]));
        analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
      } catch (err) {
        console.warn("Could not create WebAudio source for Ari:", err);
      }

      routes.set(track, {
        element: el,
        source,
        analyser,
        samples: analyser ? new Float32Array(analyser.fftSize) : new Float32Array(256),
      });

      attachHeadAudio();

      if (!room.canPlaybackAudio) {
        void room.startAudio().catch(() => {});
      }
      void context.resume().then(() => {
        window.dispatchEvent(new CustomEvent("ari:audio-status", { detail: context.state }));
      }).catch(() => {
        window.dispatchEvent(new CustomEvent("ari:audio-status", { detail: "suspended" }));
      });
    };

    const removeTrack = (track: RemoteTrack) => {
      const route = routes.get(track);
      if (!route) return;
      try {
        track.detach(route.element);
      } catch {}
      if (route.element?.parentElement) {
        route.element.parentElement.removeChild(route.element);
      }
      if (route.headAudio && route.source) {
        try { route.source.disconnect(route.headAudio); } catch {}
      }
      route.source?.disconnect();
      route.analyser?.disconnect();
      routes.delete(track);
      if (!routes.size) {
        ariGate.reset();
        resetMouth();
        emitSpeaking(false, speaking.candidate);
        if (!disposing) {
          for (const participant of room.remoteParticipants.values()) {
            for (const publication of participant.audioTrackPublications.values()) {
              if (publication.track && publication.track !== track) routeTrack(publication.track, participant);
            }
          }
        }
      }
    };

    const onSubscribed = (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => routeTrack(track, participant);
    const onUnsubscribed = (track: RemoteTrack) => removeTrack(track);
    const onParticipantChange = () => setAgentPresent();

    const onInterrupt = () => {
      ariGate.reset();
      for (const route of routes.values()) {
        if (route.element) route.element.muted = true;
      }
      window.__ariHeadAudio?.resetAll?.();
      resetMouth();
      emitSpeaking(false, speaking.candidate);
      window.__ariHead?.lookAtCamera?.(350);
    };

    const onDataReceived = (payload: Uint8Array) => {
      try {
        const data = JSON.parse(new TextDecoder().decode(payload));
        if (data.type === "turn_persisted" && data.turn) {
          window.dispatchEvent(new CustomEvent("ari:turn", { detail: data.turn }));
          // Ensure audio is unmuted when a new turn arrives
          for (const route of routes.values()) {
            if (route.element) route.element.muted = false;
          }
        }
        else if (data.type === "agent_state" && data.state && data.state !== "speaking") {
          window.dispatchEvent(new CustomEvent("ari:state", { detail: data.state }));
        }
        else if (data.type === "agent_interrupted") {
          onInterrupt();
        }
        else if (data.type === "user_transcription" && data.transcript) {
          window.dispatchEvent(new CustomEvent("ari:user-speech", { detail: data }));
        }
      } catch {}
    };

    const onMicChange = (event: Event) => {
      const enabled = Boolean((event as CustomEvent<boolean>).detail);
      void room.localParticipant.setMicrophoneEnabled(enabled);
      if (!enabled) { candidateGate.reset(); emitSpeaking(speaking.ari, false); }
    };

    const onCameraChange = (event: Event) => {
      void room.localParticipant.setCameraEnabled(Boolean((event as CustomEvent<boolean>).detail));
    };

    const onAudioResume = () => {
      void room.startAudio().catch(() => {});
      void context.resume().then(() => {
        window.dispatchEvent(new CustomEvent("ari:audio-status", { detail: context.state }));
      }).catch(() => {
        window.dispatchEvent(new CustomEvent("ari:audio-status", { detail: "suspended" }));
      });
    };

    const onReconnecting = () => window.dispatchEvent(new CustomEvent("ari:connection", { detail: "reconnecting" }));
    const onReconnected = () => {
      window.dispatchEvent(new CustomEvent("ari:connection", { detail: "connected" }));
      setAgentPresent();
      if (!room.canPlaybackAudio) void room.startAudio().catch(() => {});
    };
    const onDisconnected = () => { window.dispatchEvent(new CustomEvent("ari:connection", { detail: "disconnected" })); emitSpeaking(false, false); };

    const inspectAudio = () => {
      const now = performance.now();
      const micPublication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      const micTrack = micPublication?.track?.mediaStreamTrack;
      if (micTrack !== localTrack) {
        localSource?.disconnect(); localAnalyser?.disconnect();
        localTrack = micTrack;
        localSource = undefined; localAnalyser = undefined;
        if (micTrack) {
          localSource = context.createMediaStreamSource(new MediaStream([micTrack]));
          localAnalyser = context.createAnalyser();
          localAnalyser.fftSize = 256;
          localSamples = new Float32Array(localAnalyser.fftSize);
          localSource.connect(localAnalyser);
          localAnalyser.connect(silentGain);
        }
      }
      const candidateEnabled = Boolean(micTrack?.enabled && !micPublication?.isMuted);
      const candidateLevel = candidateEnabled ? Math.max(localAnalyser ? audioRms(localAnalyser, localSamples) : 0, room.localParticipant.isSpeaking ? 0.025 : 0) : 0;
      const candidateSpeaking = candidateGate.update(candidateLevel, now, candidateEnabled);

      let ariLevel = 0;
      for (const route of routes.values()) {
        if (route.analyser) {
          const level = audioRms(route.analyser, route.samples);
          ariLevel = Math.max(ariLevel, level);
        }
        // Unmute Ari if candidate is NOT speaking
        if (!candidateSpeaking && route.element.muted) {
          route.element.muted = false;
        }
      }

      const agentSpeaking = [...room.remoteParticipants.values()].some(participant => isAriParticipant(participant) && participant.isSpeaking);
      const ariSpeaking = ariGate.update(Math.max(ariLevel, agentSpeaking ? 0.012 : 0), now, routes.size > 0);

      // If candidate is actively speaking, mute Ari's audio element to prevent audio clash/echo
      if (candidateSpeaking && ariSpeaking) {
        for (const route of routes.values()) {
          if (route.element) route.element.muted = true;
        }
        window.__ariHeadAudio?.resetAll?.();
        resetMouth();
      }

      emitSpeaking(ariSpeaking && !candidateSpeaking, candidateSpeaking);
      tickTimer = window.setTimeout(inspectAudio, 50);
    };

    room.on(RoomEvent.TrackSubscribed, onSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, onUnsubscribed);
    room.on(RoomEvent.ParticipantConnected, onParticipantChange);
    room.on(RoomEvent.ParticipantDisconnected, onParticipantChange);
    room.on(RoomEvent.DataReceived, onDataReceived);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (!room.canPlaybackAudio) {
        window.dispatchEvent(new CustomEvent("ari:audio-status", { detail: "suspended" }));
      } else {
        window.dispatchEvent(new CustomEvent("ari:audio-status", { detail: context.state }));
      }
    });

    window.addEventListener("ari:interrupt", onInterrupt);
    window.addEventListener("ari:head-audio-ready", attachHeadAudio);
    window.addEventListener("ari:microphone", onMicChange);
    window.addEventListener("ari:camera", onCameraChange);
    window.addEventListener("ari:resume-audio", onAudioResume);

    onChatSender(async text => { await room.localParticipant.sendText(text, { topic: "lk.chat" }); });
    setAgentPresent();

    for (const participant of room.remoteParticipants.values()) {
      for (const publication of participant.audioTrackPublications.values()) {
        if (publication.track) routeTrack(publication.track, participant);
      }
    }
    inspectAudio();

    return () => {
      disposing = true;
      onChatSender(null);
      window.removeEventListener("ari:interrupt", onInterrupt);
      window.removeEventListener("ari:head-audio-ready", attachHeadAudio);
      window.removeEventListener("ari:microphone", onMicChange);
      window.removeEventListener("ari:camera", onCameraChange);
      window.removeEventListener("ari:resume-audio", onAudioResume);
      room.off(RoomEvent.TrackSubscribed, onSubscribed);
      room.off(RoomEvent.TrackUnsubscribed, onUnsubscribed);
      room.off(RoomEvent.ParticipantConnected, onParticipantChange);
      room.off(RoomEvent.ParticipantDisconnected, onParticipantChange);
      room.off(RoomEvent.DataReceived, onDataReceived);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      window.clearTimeout(tickTimer);
      for (const track of routes.keys()) removeTrack(track);
      localSource?.disconnect(); localAnalyser?.disconnect(); silentGain.disconnect();
      emitSpeaking(false, false);
      window.dispatchEvent(new CustomEvent("ari:agent-ready", { detail: false }));
    };
  }, [room, onChatSender]);

  return null;
}
