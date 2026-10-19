import { useEffect, useRef, useState } from 'react';
import { Camera, RefreshCw, X } from 'lucide-react';
import './webcamCapture.css';

type CameraState = 'starting' | 'ready' | 'capturing' | 'error';

/** A frame stays in this browser and uses the same reviewed import path as a file. */
export function WebcamCapture({ onCapture, onCancel }: {
  onCapture: (file: File) => void;
  onCancel: () => void;
}) {
  const [state, setState] = useState<CameraState>('starting');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [currentDeviceId, setCurrentDeviceId] = useState('');
  const [facing, setFacing] = useState<'environment' | 'user'>('environment');
  const [retry, setRetry] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const session = useRef(0);
  const captureInFlight = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  const stopStream = () => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  };

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    const id = ++session.current;
    let disposed = false;
    stopStream();
    captureInFlight.current = false;
    setState('starting');
    setError(null);
    const cancel = () => {
      disposed = true;
      session.current += 1;
      stopStream();
    };
    const start = async () => {
      try {
        if (!window.isSecureContext) throw new Error('Use HTTPS or localhost to open the webcam. You can also upload a screenshot.');
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot open a webcam. Try a recent browser or upload a screenshot.');
        const next = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: facing } },
        });
        if (disposed || id !== session.current) {
          next.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = next;
        const element = video.current;
        if (!element) { stopStream(); return; }
        element.srcObject = next;
        setCurrentDeviceId(next.getVideoTracks()[0]?.getSettings().deviceId ?? '');
        await element.play();
        if (disposed || id !== session.current) return;
        if (element.videoWidth > 0) setState('ready');
        // Device labels are generally available only after camera permission.
        try {
          const available = await navigator.mediaDevices.enumerateDevices();
          if (!disposed && id === session.current) setDevices(available.filter((device) => device.kind === 'videoinput'));
        } catch { /* A working camera does not need device enumeration. */ }
      } catch (failure) {
        if (disposed || id !== session.current) return;
        stopStream();
        setState('error');
        setError(cameraError(failure));
      }
    };
    window.addEventListener('pagehide', cancel);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        cancel();
        setState('error');
        setError('Camera paused while this page was hidden. Try camera again when you return.');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    void start();
    return () => {
      cancel();
      window.removeEventListener('pagehide', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [deviceId, facing, retry]);

  const close = () => {
    session.current += 1;
    stopStream();
    onCancel();
  };

  const capture = () => {
    const element = video.current;
    if (captureInFlight.current || state !== 'ready' || !element?.videoWidth || !stream.current) return;
    captureInFlight.current = true;
    const id = session.current;
    setState('capturing');
    try {
      const side = Math.min(element.videoWidth, element.videoHeight);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = Math.min(side, 2048);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('The browser could not capture this frame. Try uploading a screenshot.');
      // object-fit: cover shows this same centered square in the preview.
      context.drawImage(element, (element.videoWidth - side) / 2, (element.videoHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
      stopStream();
      canvas.toBlob((blob) => {
        if (id !== session.current) return;
        if (!blob) {
          captureInFlight.current = false;
          setState('error');
          setError('The browser could not save this frame. Try again or upload a screenshot.');
          return;
        }
        onCapture(new File([blob], `chessboard-webcam-${Date.now()}.png`, { type: 'image/png' }));
      }, 'image/png');
    } catch (failure) {
      stopStream();
      captureInFlight.current = false;
      setState('error');
      setError(cameraError(failure));
    }
  };

  return <section className="webcam-capture" aria-labelledby="webcam-heading" onKeyDown={(event) => {
    if (event.key === 'Escape') { event.preventDefault(); close(); }
  }}>
    <div className="webcam-heading">
      <h3 id="webcam-heading" ref={heading} tabIndex={-1}><Camera size={18} /> Read from webcam</h3>
      <button type="button" className="subtle-button" onClick={close} aria-label="Cancel webcam"><X size={18} /> Close</button>
    </div>
    <p>Point at a board on a screen and fit all 64 squares inside the frame. Keep the camera straight and avoid glare.</p>
    <div className="webcam-preview" aria-label="Live webcam preview">
      <video ref={video} autoPlay playsInline muted aria-label="Live camera video" onLoadedData={() => {
        if (stream.current && !captureInFlight.current) setState('ready');
      }} />
      <span className="webcam-frame" aria-hidden="true" />
      {state === 'starting' ? <span className="webcam-status" role="status">Waiting for camera…</span> : null}
      {state === 'capturing' ? <span className="webcam-status" role="status">Capturing frame…</span> : null}
    </div>
    {error ? <p className="error-strip" role="alert">{error}</p> : null}
    <div className="webcam-camera-controls">
      {devices.length > 1 ? <label>Camera<select aria-label="Camera" value={deviceId || currentDeviceId} disabled={state === 'capturing'} onChange={(event) => setDeviceId(event.target.value)}>
        {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>)}
      </select></label> : null}
      <button type="button" disabled={state === 'capturing'} onClick={() => {
        setDeviceId('');
        setFacing((value) => value === 'environment' ? 'user' : 'environment');
      }}><RefreshCw size={16} /> Switch camera</button>
    </div>
    <div className="webcam-actions">
      {state === 'error' ? <button type="button" onClick={() => setRetry((value) => value + 1)}>Try camera again</button>
        : <button type="button" className="primary-button" disabled={state !== 'ready'} onClick={capture}><Camera size={17} /> Capture position</button>}
      <button type="button" onClick={close}>Cancel</button>
    </div>
    <small>Reads 2D boards. Video stays in this browser. After capture, review the detected pieces before loading.</small>
  </section>;
}

function cameraError(failure: unknown): string {
  if (failure instanceof DOMException) {
    if (failure.name === 'NotAllowedError' || failure.name === 'SecurityError') return 'Camera access was denied. Allow camera access in your browser and try again, or upload a screenshot.';
    if (failure.name === 'NotFoundError' || failure.name === 'DevicesNotFoundError') return 'No camera was found. Connect a webcam or upload a screenshot.';
    if (failure.name === 'NotReadableError' || failure.name === 'TrackStartError') return 'The camera is unavailable or being used by another app. Close that app and try again.';
    if (failure.name === 'OverconstrainedError') return 'This camera is unavailable. Switch camera or upload a screenshot.';
  }
  return failure instanceof Error ? failure.message : 'The camera could not start. Try again or upload a screenshot.';
}
