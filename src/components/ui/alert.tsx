import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva(
  "relative grid w-full grid-cols-[auto_1fr] items-start gap-x-3 gap-y-1 rounded-xl border px-4 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4",
  {
    variants: {
      variant: {
        info: "border-primary/20 bg-accent text-foreground [&>svg]:text-primary",
        success: "border-success/25 bg-success-soft text-foreground [&>svg]:text-success-foreground",
        warning: "border-warning/25 bg-warning-soft text-foreground [&>svg]:text-warning-foreground",
        destructive: "border-destructive/25 bg-destructive-soft text-foreground [&>svg]:text-destructive-foreground",
      },
    },
    defaultVariants: { variant: "info" },
  },
);

function Alert({ className, variant, ...props }: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return <div role="alert" data-slot="alert" className={cn(alertVariants({ variant }), className)} {...props} />;
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("col-start-2 font-semibold", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("col-start-2 text-muted-foreground", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
