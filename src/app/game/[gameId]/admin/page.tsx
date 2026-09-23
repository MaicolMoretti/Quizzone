/**
 * Route del conduttore, protetta dal proxy Next.js. L’UUID identifica la
 * partita; il motore verifica inoltre che il JWT appartenga al suo creatore.
 * La chiave React evita di riutilizzare lo stato di un’altra partita.
 */
import GameRoom from '@/components/game-room';
export default async function Admin({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <GameRoom key={gameId} role="admin" identifier={gameId} />;
}
