/**
 * Route del proiettore, pubblica e di sola visualizzazione. Riceve lo stesso
 * snapshot pubblico degli altri partecipanti, senza comandi amministrativi
 * e senza facoltà di inviare risposte.
 */
import GameRoom from '@/components/game-room';
export default async function Presentation({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <GameRoom key={gameId} role="presentation" identifier={gameId} />;
}
