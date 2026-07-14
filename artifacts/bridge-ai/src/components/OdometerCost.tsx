import { useEffect, useRef, useState } from "react";
import { useSpring, useMotionValue, useTransform, motion } from "framer-motion";

interface Props {
  value: number;
  decimals?: number;
  className?: string;
}

/**
 * Refined animated cost counter.
 * The value eases toward the target with a spring — digits appear to
 * count upward like a high-end mechanical odometer, not jump abruptly.
 */
export function OdometerCost({ value, decimals = 4, className }: Props) {
  const motionVal = useMotionValue(value);
  const spring = useSpring(motionVal, { stiffness: 60, damping: 18, mass: 0.6 });
  const [display, setDisplay] = useState(value.toFixed(decimals));
  const prevRef = useRef(value);

  useEffect(() => {
    motionVal.set(value);
  }, [value, motionVal]);

  useEffect(() => {
    const unsubscribe = spring.on("change", (latest) => {
      setDisplay(latest.toFixed(decimals));
    });
    return unsubscribe;
  }, [spring, decimals]);

  const didIncrease = value > prevRef.current;
  useEffect(() => { prevRef.current = value; }, [value]);

  return (
    <motion.span
      className={`font-mono tabular-nums ${className ?? ""}`}
      animate={didIncrease ? { color: ["#10b981", "currentColor"] } : {}}
      transition={{ duration: 1.8, ease: "easeOut" }}
    >
      ${display}
    </motion.span>
  );
}
