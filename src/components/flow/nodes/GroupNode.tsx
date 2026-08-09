"use client";

import { memo } from "react";
import { NodeProps } from "reactflow";

export interface GroupNodeData {
  label: string;
  description?: string;
  color?: string;
}

export const GroupNode = memo(({ data }: NodeProps<GroupNodeData>) => {
  const backgroundColor = data.color || "#f0f0f0";

  return (
    <div
      className="group-node"
      style={{
        backgroundColor,
        border: "2px solid #ccc",
        borderRadius: "8px",
        padding: "16px",
        minWidth: "300px",
        minHeight: "200px",
        opacity: 0.3,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "8px",
          left: "8px",
          fontSize: "14px",
          fontWeight: "600",
          color: "#666",
        }}
      >
        {data.label}
      </div>
      {data.description && (
        <div
          style={{
            position: "absolute",
            top: "32px",
            left: "8px",
            fontSize: "12px",
            color: "#999",
          }}
        >
          {data.description}
        </div>
      )}
    </div>
  );
});

GroupNode.displayName = "GroupNode";
