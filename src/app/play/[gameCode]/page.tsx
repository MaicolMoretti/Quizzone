/**
 * Route pubblica del giocatore: attende i parametri asincroni di Next.js,
 * verifica il formato del codice e lascia al motore il controllo della partita.
 * La chiave React azzera lo stato del componente se cambia il codice.
 */
import GameRoom from '@/components/game-room';
import { notFound } from 'next/navigation';
export default async function Play({ params }: { params: Promise<{ gameCode: string }> }) {
  const { gameCode } = await params;
  if (!/^\d{6}$/.test(gameCode)) notFound();
  return <GameRoom key={gameCode} role="player" identifier={gameCode} />;
}
