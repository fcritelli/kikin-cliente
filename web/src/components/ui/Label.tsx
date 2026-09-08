import { type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("block text-xs font-bold uppercase tracking-wider text-black/60 mb-1.5", className)}
      {...props}
    />
  );
}
