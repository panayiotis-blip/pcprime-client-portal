import { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';

interface CameraCaptureProps {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
}

export default function CameraCapture({ onCapture, onClose }: CameraCaptureProps) {
  const webcamRef = useRef<Webcam>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('environment');

  const capture = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) { alert('Camera not ready yet — try again in a moment.'); return; }
    fetch(imageSrc).then((res) => res.blob()).then((blob) => onCapture(blob));
  }, [onCapture]);

  const switchCamera = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
  };

  return (
    <div className="camera-container">
      <div className="camera-preview">
        <Webcam
          ref={webcamRef}
          audio={false}
          screenshotFormat="image/jpeg"
          className="camera-video"
          videoConstraints={{
            facingMode,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          }}
          onUserMediaError={(err) => {
            console.error('Camera error:', err);
            alert('Could not start the camera. Check that this site has camera permission.');
            onClose();
          }}
        />
        <div className="camera-guide">
          <div className="guide-frame" />
        </div>
      </div>
      <div className="camera-controls">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary btn-capture" onClick={capture}>
          Capture
        </button>
        <button className="btn btn-secondary" onClick={switchCamera}>
          Flip
        </button>
      </div>
    </div>
  );
}
