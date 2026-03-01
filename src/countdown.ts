/**
 * Countdown overlay controller — displays a 3→2→1→GO! sequence
 * before the race starts.
 */
export function runCountdown(onStep?: (isGo: boolean) => void): Promise<void> {
    const overlay = document.getElementById('countdown-overlay')!;
    const numberEl = document.getElementById('countdown-number')!;

    return new Promise((resolve) => {
        overlay.style.display = 'flex';
        const steps = ['3', '2', '1', 'GO!'];
        let idx = 0;

        function showNext() {
            if (idx >= steps.length) {
                overlay.style.display = 'none';
                numberEl.textContent = '';
                resolve();
                return;
            }
            numberEl.textContent = steps[idx];
            // Force animation restart by removing and re-adding
            numberEl.style.animation = 'none';
            void numberEl.offsetWidth; // trigger reflow
            numberEl.style.animation = '';
            // GO! is green, numbers are white
            numberEl.style.color = steps[idx] === 'GO!' ? '#44ff44' : 'white';
            if (onStep) onStep(steps[idx] === 'GO!');
            idx++;
            setTimeout(showNext, 900);
        }
        showNext();
    });
}
