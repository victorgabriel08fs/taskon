/**
 * O quadro sem card aberto. Tudo o que se vê mora no layout; esta página só
 * existe para a rota `/boards/[boardId]` responder. Ao tomar o lugar da
 * página do card, ela desmonta a ponte do deep link — e é isso que fecha o
 * modal (ver src/components/board/active-card.tsx).
 */
export default function BoardPage() {
    return null;
}
