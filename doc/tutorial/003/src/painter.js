var cvs;
var canvas;

function mouseListener(event) {
  switch (event.type) {
    case "mousedown":
      console.log("mousedown");
      break;
    case "mousemove":
      console.log("mousemove");
      break;
    case "mouseup":
      console.log("mouseup");
      break;
    case "mouseout":
      console.log("mouseout");
      break;
  }
}

function onLoadPage() {
  canvas = document.getElementById("canvas");
  cvs = canvas.getContext("2d");

  canvas.addEventListener("mousedown", mouseListener);
  canvas.addEventListener("mousemove", mouseListener);
  canvas.addEventListener("mouseout", mouseListener);
  canvas.addEventListener("mouseup", mouseListener);
}

window.onload = onLoadPage();
