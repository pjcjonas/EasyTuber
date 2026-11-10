/* Intro video: plays full-window when the editor opens, once per launch.
   Never in the stage window (?stage=1), which OBS captures. Click or any key skips it. */
(function () {
  const box = document.getElementById('intro');
  const video = document.getElementById('introVideo');
  if (!box || !video) return;

  let seen = false;
  try { seen = sessionStorage.getItem('easytuber.introSeen') === '1'; } catch (e) { /* storage blocked */ }
  if (new URLSearchParams(location.search).has('stage') || seen) { box.remove(); return; }
  try { sessionStorage.setItem('easytuber.introSeen', '1'); } catch (e) { /* storage blocked */ }

  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    window.removeEventListener('keydown', onKey, true);
    video.pause();
    box.classList.add('out');
    setTimeout(() => box.remove(), 600);
  };
  // swallow the key so a skip doesn't also trigger an app shortcut (e.g. Space = test talk)
  const onKey = (e) => { e.preventDefault(); e.stopPropagation(); finish(); };

  box.hidden = false;
  box.addEventListener('click', finish);
  window.addEventListener('keydown', onKey, true);
  video.addEventListener('ended', finish);
  video.addEventListener('error', finish);
  setTimeout(finish, 20000); // never trap the user behind a stalled video

  video.play().catch(() => {
    // autoplay with sound refused (e.g. opened in a normal browser): try muted, else skip
    video.muted = true;
    video.play().catch(finish);
  });
})();
