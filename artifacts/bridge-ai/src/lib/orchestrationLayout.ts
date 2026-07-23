export interface OrchestrationPoint {
  x: number;
  y: number;
  ring: number;
}

export interface OrchestrationLayout {
  centerX: number;
  centerY: number;
  radius: number;
  points: OrchestrationPoint[];
}

interface LayoutInput {
  width: number;
  height: number;
  count: number;
  mobile: boolean;
  detailsOpen: boolean;
}

/**
 * Builds a stable radial constellation. Small teams use one ring. Larger teams
 * are distributed across two rings so labels and touch targets do not collide.
 */
export function buildOrchestrationLayout({
  width,
  height,
  count,
  mobile,
  detailsOpen,
}: LayoutInput): OrchestrationLayout {
  const horizontalSafeZone = mobile ? 82 : 118;
  const topSafeZone = mobile ? 104 : 110;
  const bottomSafeZone = detailsOpen ? (mobile ? 178 : 132) : 94;
  const usableHeight = Math.max(190, height - topSafeZone - bottomSafeZone);
  const centerX = width / 2;
  const centerY = topSafeZone + usableHeight / 2;
  const maxHorizontalRadius = Math.max(78, width / 2 - horizontalSafeZone);
  const maxVerticalRadius = Math.max(78, usableHeight / 2 - 28);
  const radius = Math.max(78, Math.min(maxHorizontalRadius, maxVerticalRadius, mobile ? 148 : 224));

  if (count <= 0) return { centerX, centerY, radius, points: [] };
  if (count === 1) {
    return {
      centerX,
      centerY,
      radius,
      points: [{ x: centerX, y: centerY - radius, ring: 0 }],
    };
  }

  const minimumSpacing = mobile ? 86 : 100;
  const outerCapacity = Math.max(4, Math.floor((2 * Math.PI * radius) / minimumSpacing));
  const useTwoRings = count > outerCapacity;
  const innerRadius = Math.max(mobile ? 86 : 104, radius * 0.57);
  const innerCapacity = Math.max(3, Math.floor((2 * Math.PI * innerRadius) / minimumSpacing));

  const ringCounts = useTwoRings
    ? [Math.min(innerCapacity, Math.max(3, count - outerCapacity)), count - Math.min(innerCapacity, Math.max(3, count - outerCapacity))]
    : [count];
  const ringRadii = useTwoRings ? [innerRadius, radius] : [radius];
  const points: OrchestrationPoint[] = [];

  ringCounts.forEach((ringCount, ringIndex) => {
    const ringRadius = ringRadii[ringIndex];
    const offset = ringIndex === 0 && useTwoRings ? -Math.PI / 2 : -Math.PI / 2 + (useTwoRings ? Math.PI / Math.max(ringCount, 1) : 0);
    for (let index = 0; index < ringCount; index += 1) {
      const angle = (2 * Math.PI * index) / ringCount + offset;
      points.push({
        x: centerX + ringRadius * Math.cos(angle),
        y: centerY + ringRadius * Math.sin(angle),
        ring: ringIndex,
      });
    }
  });

  return { centerX, centerY, radius, points };
}
