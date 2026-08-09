"use client";

import React from "react";

export interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

export interface DialogContentProps {
  children: React.ReactNode;
  className?: string;
}

export interface DialogHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export interface DialogTitleProps {
  children: React.ReactNode;
  className?: string;
}

export interface DialogDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm"
            onClick={() => onOpenChange?.(false)}
          />
          <div className="relative z-50">{children}</div>
        </div>
      )}
    </>
  );
}

export function DialogContent({ children, className = "" }: DialogContentProps) {
  return (
    <div
      className={`relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-apple-float ${className}`}
    >
      {children}
    </div>
  );
}

export function DialogHeader({ children, className = "" }: DialogHeaderProps) {
  return <div className={`flex flex-col space-y-2 ${className}`}>{children}</div>;
}

export function DialogTitle({ children, className = "" }: DialogTitleProps) {
  return <h2 className={`text-2xl font-semibold ${className}`}>{children}</h2>;
}

export function DialogDescription({ children, className = "" }: DialogDescriptionProps) {
  return <p className={`text-sm text-muted-foreground ${className}`}>{children}</p>;
}

export function DialogTrigger({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <div onClick={onClick}>{children}</div>;
}

export interface DialogFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function DialogFooter({ children, className = "" }: DialogFooterProps) {
  return <div className={`flex items-center justify-end gap-2 pt-4 ${className}`}>{children}</div>;
}
