import * as S from "@radix-ui/react-slider";

export function Slider({
  value,
  onValueChange,
  max = 100,
  step = 1,
}: {
  value: number;
  onValueChange: (v: number) => void;
  max?: number;
  step?: number;
}) {
  return (
    <S.Root
      className="relative flex h-5 w-full grow touch-none select-none items-center"
      value={[value]}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(v[0])}
    >
      <S.Track className="relative h-1.5 grow rounded-full bg-gradient-to-r from-coch via-ochre to-faint">
        <S.Range className="absolute h-full rounded-full" />
      </S.Track>
      <S.Thumb className="block h-4 w-4 rounded-full border-2 border-coch bg-white shadow-sm outline-none transition hover:scale-110" />
    </S.Root>
  );
}
