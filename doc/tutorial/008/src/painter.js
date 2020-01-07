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

Shape.prototype.preprocessMouseDown = function() {
    bufCtx.drawImage(canvas, 0, 0);
    bufCtx.strokeStyle = painter.getColor();
    var startPos = getMousePosition(event);
    this.point.x = startPos.X;
    this.point.y = startPos.Y;
    this.setDrawMode(true);
}

Shape.prototype.preprocessMouseMove = function() {
  cvs.beginPath();
  // Need a delay
  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);

  cvs.strokeStyle = painter.getColor();
}

Shape.prototype.postprocessMouseMove = function() {
  cvs.closePath();
  cvs.stroke();
}

Shape.prototype.preprocessMouseUp = function() {
  bufCtx.beginPath();
  bufCtx.strokeStyle = painter.getColor();
}

Shape.prototype.postprocessMouseUp = function() {
  bufCtx.closePath();
  bufCtx.stroke();

  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);

  this.setDrawMode(false);
}


function lineMouseDown(event) {
    console.log("lineMouseDown");
    if (painter.isDraw()) {
      return;
    }
    painter.preprocessMouseDown();
}

function lineMouseMove(event) {
    if (!painter.isDraw()) {
      return;
    }
    painter.preprocessMouseMove();

    var currentPos = getMousePosition(event);
    cvs.moveTo(painter.shape.point.x, painter.shape.point.y);
    cvs.lineTo(currentPos.X, currentPos.Y);
    painter.postprocessMouseMove();
}


function lineMouseUp(event) {
  if (!painter.isDraw()) {
    return;
  }
  console.log("lineMouseUp");

  painter.preprocessMouseUp();

  var currentPos = getMousePosition(event);
  bufCtx.moveTo(painter.shape.point.x, painter.shape.point.y);
  bufCtx.lineTo(currentPos.X, currentPos.Y);

  painter.postprocessMouseUp();
}

function circleMouseDown(event) {
    console.log("circleMouseDown");    
    if (painter.isDraw()) {
        return;
    }
    painter.preprocessMouseDown();
}

function circleMouseMove(event) {
  if (!painter.isDraw()) {
    return;
  }
  painter.preprocessMouseMove();
  var currentPos = getMousePosition(event);
  var circle = {
    X: Math.round((painter.shape.point.x + currentPos.X) / 2),
    Y: Math.round((painter.shape.point.y + currentPos.Y) / 2),
    R: Math.round(Math.abs(currentPos.Y - painter.shape.point.y) / 2)
  };
  cvs.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);
  painter.postprocessMouseMove();
}

function circleMouseUp(event) {
  if (!painter.isDraw()) {
    return;
  }

  painter.preprocessMouseUp();

  var currentPos = getMousePosition(event);
  var circle = {
    X: Math.round((painter.shape.point.x + currentPos.X) / 2),
    Y: Math.round((painter.shape.point.y + currentPos.Y) / 2),
    R: Math.round(Math.abs(currentPos.Y - painter.shape.point.y) / 2)
  };
  bufCtx.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);

  painter.postprocessMouseUp();
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
  this.mouseAction = this.shape.mouseAction;
}

Painter.prototype.setShape = function(shapeName) {
  this.shape = this.tools[shapeName];
  this.mouseAction = this.shape.mouseAction;
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

Painter.prototype.preprocessMouseDown = function() {
  this.shape.preprocessMouseDown();
}

Painter.prototype.preprocessMouseMove = function() {
  this.shape.preprocessMouseMove();
}

Painter.prototype.postprocessMouseMove = function() {
  this.shape.postprocessMouseMove();
}

Painter.prototype.preprocessMouseUp = function() {
  this.shape.preprocessMouseUp();
}

Painter.prototype.postprocessMouseUp = function() {
  this.shape.postprocessMouseUp();
}

function mouseListener(event) {
  switch (event.type) {
    case "mousedown":
      //console.log("mousedown");
      painter.mouseAction.down(event);
      break;
    case "mousemove":
      //console.log("mousemove");
      painter.mouseAction.move(event);
      break;
    case "mouseup":
      //console.log("mouseup");
      painter.mouseAction.up(event);
      break;
    case "mouseout":
      painter.mouseAction.up(event);
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