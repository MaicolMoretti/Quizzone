import GameRoom from '@/components/game-room';
export default async function Presentation({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  return <GameRoom key={gameId} role="presentation" identifier={gameId} />;
}
