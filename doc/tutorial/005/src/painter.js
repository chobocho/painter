var cvs;
var canvas;

var bufCanvas;
var bufCtx;

var painter;

function Point(x_, y_) {
    this.x = x_;
    this.y = y_;
}

Point.prototype.toString = function () {
    return '(' + this.x + "," + this.y + ")";
}

function getMousePosition(event) {
  var x = event.pageX - canvas.offsetLeft;
  var y = event.pageY - canvas.offsetTop;
  return { X: x, Y: y };
}

function MouseAction(mouseUp, mouseDown, mouseMove) {
    this.up = mouseUp;
    this.down = mouseDown;
    this.move = mouseMove;
}

function Shape(name_) {
    this.name = name_;
    this.point = new Point(0, 0);
    this.color = "black";
    this.state = false;
    this.filled = false;
    this.mouseAction;
}

Shape.prototype.setColor = function(color) {
    this.color = color;
}

Shape.prototype.getColor = function() {
    return this.color;
} 

Shape.prototype.toString = function() {
    return '(' + 
           'name:' + this.name + ' ' +
           'Point:' + this.point.toString() + 
           'color:' + this.color + ' ' +
           'state:' + this.state + ' ' +
           'filled:' + this.filled + ' ' +
           ')';
}

Shape.prototype.isDraw = function () {
    return this.state;
}

Shape.prototype.setDrawMode = function (state) {
    return this.state = state;
}


function lineMouseUp(event) {
  if (!painter.isDraw()) {
    return;
  }
  console.log("lineMouseUp");
  var currentPos = getMousePosition(event);
  bufCtx.beginPath();
  bufCtx.strokeStyle = painter.shape.getColor();
  bufCtx.moveTo(painter.shape.point.x, painter.shape.point.y);
  bufCtx.lineTo(currentPos.X, currentPos.Y);
  bufCtx.closePath();
  bufCtx.stroke();
  cvs.drawImage(bufCanvas, 0, 0);

  painter.setDrawMode(false);
}

function lineMouseDown(event) {
  console.log("lineMouseDown");
  if (painter.isDraw()) {
    return;
  }
  bufCtx.drawImage(canvas, 0, 0);
  bufCtx.strokeStyle = painter.shape.getColor();
  var startPos = getMousePosition(event);
  painter.shape.point.x = startPos.X;
  painter.shape.point.y = startPos.Y;
  painter.setDrawMode(true);
}

function lineMouseMove(event) {
  if (!painter.isDraw()) {
    return;
  }
  // console.log("lineMouseMove");
  
  var currentPos = getMousePosition(event);
  cvs.beginPath();
  // Need a delay
  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);

  cvs.strokeStyle = painter.shape.getColor();
  cvs.moveTo(painter.shape.point.x, painter.shape.point.y);
  cvs.lineTo(currentPos.X, currentPos.Y);
  cvs.closePath();
  cvs.stroke();
}


function Painter() {
    this.shape = new Shape("Line");
    this.shape.mouseAction = new MouseAction(lineMouseUp, lineMouseDown, lineMouseMove);
}

Painter.prototype.toString = function () {
    return '(' + 
           'Shape:' + this.shape.toString() + 
           ')';
}

Painter.prototype.isDraw = function () {
    return this.shape.isDraw();
}

Painter.prototype.setDrawMode = function (state) {
    return this.shape.setDrawMode(state);
}

function mouseListener(event) {
  switch (event.type) {
    case "mousedown":
      //console.log("mousedown");
      painter.shape.mouseAction.down(event);
      break;
    case "mousemove":
      //console.log("mousemove");
      painter.shape.mouseAction.move(event);
      break;
    case "mouseup":
      //console.log("mouseup");
      painter.shape.mouseAction.up(event);
      break;
    case "mouseout":
      painter.shape.mouseAction.up(event);
      //console.log("mouseout");
      break;
  }
}

function selectColor(choosedColor) {
  console.log("selectColor:" + choosedColor);
  painter.shape.setColor(choosedColor);
}


function onLoadPage() {
  canvas = document.getElementById("canvas");
  cvs = canvas.getContext("2d");

  bufCanvas = document.createElement("canvas");
  bufCanvas.width = canvas.width;
  bufCanvas.height = canvas.height;
  bufCtx = bufCanvas.getContext("2d");

  canvas.addEventListener("mousedown", mouseListener);
  canvas.addEventListener("mousemove", mouseListener);
  canvas.addEventListener("mouseout", mouseListener);
  canvas.addEventListener("mouseup", mouseListener);
  
  painter = new Painter();
}

window.onload = onLoadPage();