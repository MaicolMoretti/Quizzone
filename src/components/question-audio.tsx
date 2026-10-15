"use client";

import { useEffect, useRef, useState } from 'react';

// Il chiamante usa una key per domanda/URL: cambiando domanda il lettore viene
// smontato, interrompendo l'audio precedente e azzerando posizione ed errori.
export default function QuestionAudio({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const audio = audioRef.current;
    return () => { audio?.pause(); };
  }, []);
  let valid = false;
  try { valid = ['http:', 'https:'].includes(new URL(src).protocol); } catch { /* Non caricare URL non validi. */ }
  if (!valid) return null;
  return <div className="mx-auto w-full max-w-xl space-y-2">
    <p className="font-semibold">Ascolta la traccia e scegli la risposta.</p>
    <audio ref={audioRef} aria-label="Traccia audio della domanda" controls preload="none" className="w-full" onError={() => setFailed(true)} onLoadedData={() => setFailed(false)}>
      <source src={src} onError={() => setFailed(true)} />
      Il browser non supporta la riproduzione audio.
    </audio>
    {failed && <p role="alert" className="text-sm">Impossibile riprodurre la traccia. Verifica che il link punti a un file audio accessibile e supportato dal browser.</p>}
  </div>;
}
