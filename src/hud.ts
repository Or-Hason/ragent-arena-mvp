/** Draws static tick marks and speed numbers on the speedometer canvas. Called once at init. */
export function drawSpeedoGauge(): void {
    const canvas = document.getElementById('speedo-canvas') as HTMLCanvasElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;

    const cx = 80;
    const cy = 80;
    const outerR = 74;
    const majorLen = 12;
    const minorLen = 7;
    const maxSpeed = 220;
    const arcStart = -225; // degrees (CSS -135 from vertical → canvas -225 from +x)
    const arcSpan = 270;

    ctx.clearRect(0, 0, 160, 160);

    for (let speed = 0; speed <= maxSpeed; speed += 10) {
        const fraction = speed / maxSpeed;
        const angleDeg = arcStart + fraction * arcSpan;
        const angleRad = (angleDeg * Math.PI) / 180;

        const isMajor = speed % 20 === 0;
        const len = isMajor ? majorLen : minorLen;

        const x1 = cx + Math.cos(angleRad) * outerR;
        const y1 = cy + Math.sin(angleRad) * outerR;
        const x2 = cx + Math.cos(angleRad) * (outerR - len);
        const y2 = cy + Math.sin(angleRad) * (outerR - len);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = isMajor ? '#ffffff' : 'rgba(255,255,255,0.4)';
        ctx.lineWidth = isMajor ? 2 : 1;
        ctx.stroke();

        if (isMajor) {
            const numR = outerR - majorLen - 9;
            const nx = cx + Math.cos(angleRad) * numR;
            const ny = cy + Math.sin(angleRad) * numR;

            ctx.fillStyle = '#cccccc';
            ctx.font = 'bold 9px monospace';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(speed), nx, ny);
        }
    }
}
