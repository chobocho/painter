var cvs;
var canvas;
var painter;

function Point(x_, y_) {
    this.x = x_;
    this.y = y_;
}

Point.prototype.toString = function () {
    return '(' + this.x + "," + this.y + ")";
}

function MouseAction(mouseUp, mouseDown, mouseMove) {
    this.up = mouseUp;
    this.down = mouseDown;
    this.move = mouseMove;
}

function Shape(name_) {
    this.name = name_;
    this.point = new Point(0, 0);
    this.color = 0;
    this.state = 0;
    this.filled = false;
    this.mouseAction;
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

function Painter() {
    this.shape = new Shape("Point");
}

Painter.prototype.toString = function () {
    return '(' + 
           'Shape:' + this.shape.toString() + 
           ')';
}

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
  
  painter = new Painter();
}

window.onload = onLoadPage();