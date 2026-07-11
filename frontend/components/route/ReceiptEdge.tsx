import { View } from 'react-native';

interface ReceiptEdgeProps {
  notchColor: string;
  notchCount?: number;
}

// 예산 화면 시그니처 — 카드 바로 아래 배치하면 반원 노치가 카드 하단을 "톱니(찢은 영수증)"처럼
// 물어뜯은 것으로 보임. SVG 없이 원형 View 행 + 음수 marginTop만으로 구현(측정 없이 폭 대응).
export function ReceiptEdge({ notchColor, notchCount = 14 }: ReceiptEdgeProps) {
  return (
    <View
      className="flex-row justify-between px-2"
      style={{ marginTop: -7 }}
      pointerEvents="none"
    >
      {Array.from({ length: notchCount }).map((_, i) => (
        <View
          key={i}
          style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: notchColor }}
        />
      ))}
    </View>
  );
}
