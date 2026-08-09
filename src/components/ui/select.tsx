"use client";

import React from "react";

export interface SelectProps {
  value?: string;
  onValueChange?: (value: string) => void;
  children: React.ReactNode;
}

export interface SelectTriggerProps {
  className?: string;
  children: React.ReactNode;
}

export interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

export interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
}

export function Select({ value, onValueChange, children }: SelectProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="relative">
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            value,
            onValueChange,
            open,
            setOpen,
          });
        }
        return child;
      })}
    </div>
  );
}

export function SelectTrigger({ className = "", children, ...props }: SelectTriggerProps & any) {
  return (
    <button
      type="button"
      className={`flex h-10 w-full items-center justify-between rounded-xl border border-border bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      onClick={() => props.setOpen?.(!props.open)}
    >
      {children}
    </button>
  );
}

export function SelectValue({ placeholder }: { placeholder?: string }) {
  return <span className="text-muted-foreground">{placeholder}</span>;
}

export function SelectContent({ children, className = "", ...props }: SelectContentProps & any) {
  if (!props.open) return null;

  return (
    <div
      className={`absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-xl border border-border bg-card shadow-apple-float ${className}`}
    >
      {React.Children.map(children, (child) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(child as React.ReactElement<any>, {
            onValueChange: props.onValueChange,
            setOpen: props.setOpen,
          });
        }
        return child;
      })}
    </div>
  );
}

export function SelectItem({ value, children, className = "", ...props }: SelectItemProps & any) {
  return (
    <div
      className={`relative flex cursor-pointer select-none items-center px-3 py-2 text-sm hover:bg-muted ${className}`}
      onClick={() => {
        props.onValueChange?.(value);
        props.setOpen?.(false);
      }}
    >
      {children}
    </div>
  );
}
