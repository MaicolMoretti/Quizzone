import GameRoom from '@/components/game-room';
export default async function Admin({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <GameRoom key={gameId} role="admin" identifier={gameId} />;
}
