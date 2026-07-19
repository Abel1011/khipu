import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const button = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg border font-medium transition select-none outline-none disabled:opacity-50 disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-white border-line text-ink shadow-sm hover:border-coch hover:text-coch",
        primary: "bg-coch border-coch text-white hover:brightness-110",
        danger: "bg-white border-[#eabfba] text-coch hover:bg-[#fdf1ef]",
        ghost: "border-transparent text-muted hover:bg-wash hover:text-ink",
      },
      size: {
        sm: "text-xs px-2.5 py-1.5",
        md: "text-[13px] px-3.5 py-2.5",
        icon: "p-2",
      },
    },
    defaultVariants: { variant: "default", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";
