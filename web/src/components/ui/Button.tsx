import { type ButtonHTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "outline" | "ghost";
  size?: "sm" | "md" | "lg";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-bold uppercase tracking-wider transition-all cursor-pointer select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2",
        variant === "primary" && "bg-black text-white hover:bg-blue-600 hover:shadow-[0_8px_30px_-6px_rgba(37,99,235,0.5)]",
        variant === "outline" && "border-2 border-black bg-white text-black hover:bg-blue-600 hover:border-blue-600 hover:text-white",
        variant === "ghost" && "text-black hover:bg-black/5",
        size === "sm" && "px-4 py-2 text-xs",
        size === "md" && "px-6 py-3 text-sm",
        size === "lg" && "px-8 py-4 text-sm",
        className
      )}
      {...props}
    />
  )
);
Button.displayName = "Button";
