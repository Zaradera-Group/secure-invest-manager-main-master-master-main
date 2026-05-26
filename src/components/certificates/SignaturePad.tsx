import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

interface SignaturePadProps {
  onChange: (value: string | null) => void;
  onValidityChange?: (isValid: boolean) => void;
}

const MIN_SIGNATURE_POINTS = 24;
const MIN_SIGNATURE_PIXELS = 180;

export function SignaturePad({ onChange, onValidityChange }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [isSignatureValid, setIsSignatureValid] = useState(false);
  const pointCountRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = '#111827';
  }, []);

  useEffect(() => {
    onValidityChange?.(isSignatureValid);
  }, [isSignatureValid, onValidityChange]);

  const getCoordinates = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startDrawing = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const { x, y } = getCoordinates(event);
    context.beginPath();
    context.moveTo(x, y);
    pointCountRef.current += 1;
    setIsDrawing(true);
  };

  const draw = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const { x, y } = getCoordinates(event);
    context.lineTo(x, y);
    context.stroke();
    pointCountRef.current += 1;
  };

  const stopDrawing = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (!canvas) {
      setIsSignatureValid(false);
      onChange(null);
      return;
    }

    const isValid = hasMeaningfulSignature(canvas, pointCountRef.current);
    setIsSignatureValid(isValid);
    onChange(isValid ? canvas.toDataURL('image/png') : null);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    pointCountRef.current = 0;
    setIsSignatureValid(false);
    onChange(null);
  };

  return (
    <div className="space-y-3">
      <canvas
        ref={canvasRef}
        width={560}
        height={180}
        className="w-full rounded-lg border bg-white touch-none"
        onPointerDown={startDrawing}
        onPointerMove={draw}
        onPointerUp={stopDrawing}
        onPointerLeave={stopDrawing}
      />
      {!isSignatureValid && pointCountRef.current > 0 && (
        <p className="text-xs text-amber-700">
          Complete the full signature before submitting.
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" variant="outline" onClick={clear}>
          Clear Signature
        </Button>
      </div>
    </div>
  );
}

function hasMeaningfulSignature(canvas: HTMLCanvasElement, pointCount: number) {
  if (pointCount < MIN_SIGNATURE_POINTS) {
    return false;
  }

  const context = canvas.getContext('2d');
  if (!context) {
    return false;
  }

  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  let inkedPixels = 0;

  for (let index = 3; index < data.length; index += 4) {
    if (data[index] > 0) {
      inkedPixels += 1;
    }
  }

  return inkedPixels >= MIN_SIGNATURE_PIXELS;
}
