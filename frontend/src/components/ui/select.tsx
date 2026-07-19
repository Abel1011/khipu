import * as S from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Select({
  value,
  onValueChange,
  children,
  className,
  ariaLabel,
  leading,
}: {
  value: string;
  onValueChange: (v: string) => void;
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  leading?: ReactNode;
}) {
  return (
    <S.Root value={value} onValueChange={onValueChange}>
      <S.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex items-center gap-2 rounded-lg border border-line bg-white py-1.5 pl-1.5 pr-2.5 text-[13px] text-ink shadow-sm outline-none transition max-w-[62vw] sm:max-w-none data-[state=open]:border-coch hover:border-line2",
          className,
        )}
      >
        {leading}
        <span className="selvalue min-w-0 truncate">
          <S.Value />
        </span>
        <S.Icon className="shrink-0 text-faint">
          <ChevronDown size={14} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          className="z-50 overflow-hidden rounded-xl border border-line bg-white shadow-lg"
        >
          <S.Viewport className="p-1">{children}</S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}

export function SelectItem({ value, children }: { value: string; children: ReactNode }) {
  return (
    <S.Item
      value={value}
      className="flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none data-[highlighted]:bg-wash"
    >
      <S.ItemText>{children}</S.ItemText>
      <S.ItemIndicator className="ml-auto text-coch">
        <Check size={14} />
      </S.ItemIndicator>
    </S.Item>
  );
}
