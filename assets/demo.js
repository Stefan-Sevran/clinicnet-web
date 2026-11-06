(() => {
  const root = document.querySelector('[data-demo-carousel]');
  if (!root) return;
  const images = [
    'https://pub-f73102b5466f401ba8b4ee944dca2a6f.r2.dev/Carousel%20Demo%20page/Ai-autoresponse-missed-calls1.webp',
    'https://pub-f73102b5466f401ba8b4ee944dca2a6f.r2.dev/Carousel%20Demo%20page/Ai-autoresponse-missed-calls2.webp',
    'https://pub-f73102b5466f401ba8b4ee944dca2a6f.r2.dev/Carousel%20Demo%20page/Ai-autoresponse-missed-calls3.webp',
    'https://pub-f73102b5466f401ba8b4ee944dca2a6f.r2.dev/Carousel%20Demo%20page/Ai-autoresponse-missed-calls4.webp'
  ];
  const img = root.querySelector('[data-demo-image]');
  const dots = document.querySelector('[data-demo-dots]');
  let index = 0, timer;
  const render = () => {
    img.src = images[index];
    [...dots.children].forEach((d,i)=>d.classList.toggle('is-active',i===index));
  };
  images.forEach((_,i)=>{
    const b=document.createElement('button');
    b.type='button'; b.className='demo-dot'+(i===0?' is-active':'');
    b.setAttribute('aria-label','Show testimonial '+(i+1));
    b.addEventListener('click',()=>{index=i;render();restart();});
    dots.appendChild(b);
  });
  const next=()=>{index=(index+1)%images.length;render()};
  const prev=()=>{index=(index-1+images.length)%images.length;render()};
  const restart=()=>{clearInterval(timer);timer=setInterval(next,5200)};
  root.querySelector('.demo-next').addEventListener('click',()=>{next();restart()});
  root.querySelector('.demo-prev').addEventListener('click',()=>{prev();restart()});
  restart();
})();
