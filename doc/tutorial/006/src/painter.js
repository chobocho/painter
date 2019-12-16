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
    this.state = false;
    this.filled = false;
    this.mouseAction;
}

Shape.prototype.toString = function() {
    return '(' + 
           'name:' + this.name + ' ' +
           'Point:' + this.point.toString() + 
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
  bufCtx.strokeStyle = painter.getColor();
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
  bufCtx.strokeStyle = painter.getColor();
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

  cvs.strokeStyle = painter.getColor();
  cvs.moveTo(painter.shape.point.x, painter.shape.point.y);
  cvs.lineTo(currentPos.X, currentPos.Y);
  cvs.closePath();
  cvs.stroke();
}

function circleMouseDown(event) {
  console.log("circleMouseDown");
  if (painter.isDraw()) {
    return;
  }
  bufCtx.drawImage(canvas, 0, 0);
  var startPos = getMousePosition(event);
  painter.shape.point.x = startPos.X;
  painter.shape.point.y = startPos.Y;
  painter.setDrawMode(true);

}

function circleMouseMove(event) {
  if (!painter.isDraw()) {
    return;
  }
  var currentPos = getMousePosition(event);
  cvs.beginPath();
  // Need a delay
  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);

  cvs.strokeStyle = painter.getColor();

  var circle = {
    X: Math.round((painter.shape.point.x + currentPos.X) / 2),
    Y: Math.round((painter.shape.point.y + currentPos.Y) / 2),
    R: Math.round(Math.abs(currentPos.Y - painter.shape.point.y) / 2)
  };
  cvs.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);
  cvs.closePath();
  cvs.stroke();
}

function circleMouseUp(event) {
  if (!painter.isDraw()) {
    return;
  }

  var currentPos = getMousePosition(event);
  bufCtx.beginPath();
  bufCtx.strokeStyle = painter.getColor();

  var circle = {
    X: Math.round((painter.shape.point.x + currentPos.X) / 2),
    Y: Math.round((painter.shape.point.y + currentPos.Y) / 2),
    R: Math.round(Math.abs(currentPos.Y - painter.shape.point.y) / 2)
  };
  bufCtx.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);
  bufCtx.closePath();
  bufCtx.stroke();

  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);

  painter.setDrawMode(false);
}


function Painter() {
    this.tools = {}
}

Painter.prototype.init = function () {
  line = new Shape("Line");
  line.mouseAction = new MouseAction(lineMouseUp, lineMouseDown, lineMouseMove);
  this.tools[line.name] = line;

  circle = new Shape("Circle");
  circle.mouseAction = new MouseAction(circleMouseUp, circleMouseDown, circleMouseMove);
  this.tools[circle.name] = circle;

  this.shape = this.tools["Line"];
  this.color = "black";
}

Painter.prototype.setShape = function(shapeName) {
  this.shape = this.tools[shapeName];
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

Painter.prototype.getColor = function () {
  return this.color;
}

Painter.prototype.setColor = function(choosedColor) {
  this.color = choosedColor;
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
  painter.setColor(choosedColor);
}

function selectShape(choosedShape) {
  console.log("selectShape:" + choosedShape);
  painter.setShape(choosedShape);
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
  painter.init();
}

window.onload = onLoadPage();