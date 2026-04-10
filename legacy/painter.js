// Updated: 2026.01.30 - Modernized to ES6+
let cvs;
let canvas;

let bufCanvas;
let bufCtx;

let commandHistory = [];
let redoHistory = [];

const paintMode = [
  "point",
  "line",
  "circle",
  "filledcircle",
  "square",
  "filledsquare",
  "rect",
  "filledrect",
  "tri",
  "filledtri",
  "ellipse",
  "filledellipse",
  "pencil_begin",
  "pencil_end"
];

const toolTable = {
  pencil: 0,
  line: 1,
  circle: 2,
  filledcircle: 3,
  square: 4,
  filledsquare: 5,
  rect: 6,
  filledrect: 7,
  tri: 8,
  filledtri: 9,
  ellipse: 10,
  filledellipse: 11
};

const pointShape = {
  mouseDown: pointMouseDown,
  mouseMove: pointMouseMove,
  mouseUp: pointMouseUp
};

const shapeList = [pointShape];

const paintMouseDownAction = {
  point: pointMouseDown,
  line: lineMouseDown,
  circle: circleMouseDown,
  filledcircle: circleMouseDown,
  square: squareMouseDown,
  filledsquare: squareMouseDown,
  rect: rectMouseDown,
  filledrect: rectMouseDown,
  tri: triMouseDown,
  filledtri: triMouseDown,
  ellipse: ellipseMouseDown,
  filledellipse: ellipseMouseDown
};

const paintMouseUpAction = {
  point: pointMouseUp,
  line: lineMouseUp,
  circle: circleMouseUp,
  filledcircle: circleMouseUp,
  square: squareMouseUp,
  filledsquare: squareMouseUp,
  rect: rectMouseUp,
  filledrect: rectMouseUp,
  tri: triMouseUp,
  filledtri: triMouseUp,
  ellipse: ellipseMouseUp,
  filledellipse: ellipseMouseUp
};

const paintMouseMoveAction = {
  point: pointMouseMove,
  line: lineMouseMove,
  circle: circleMouseMove,
  filledcircle: circleMouseMove,
  square: squareMouseMove,
  filledsquare: squareMouseMove,
  rect: rectMouseMove,
  filledrect: rectMouseMove,
  tri: triMouseMove,
  filledtri: triMouseMove,
  ellipse: ellipseMouseMove,
  filledellipse: ellipseMouseMove
};

const pos = {
  isDraw: false,
  color: "red",
  colorIdx: 0,
  drawMode: 0,
  filled: false,
  mouseDownAction: paintMouseDownAction[paintMode[0]],
  mouseUpAction: paintMouseUpAction[paintMode[0]],
  mouseMoveAction: paintMouseMoveAction[paintMode[0]],
  x: 0,
  y: 0,
  update(drawMode) {
    this.drawMode = drawMode;
    this.mouseDownAction = paintMouseDownAction[paintMode[drawMode]];
    this.mouseUpAction = paintMouseUpAction[paintMode[drawMode]];
    this.mouseMoveAction = paintMouseMoveAction[paintMode[drawMode]];
  }
};

const point = () => ({
  X: 0,
  Y: 0
});

const drawCommand = () => ({
  mode: paintMode[0],
  color: "white",
  filled: false,
  X1: point(),
  X2: point(),
  X3: point(),
  R: 0,
  A: 0,
  B: 0,
  lines: [],
  toCommand() {
    console.log("toCommand");
    let newCommand = `${this.mode} `;
    const isFilled = this.filled ? 'F' : 'E';
    switch (this.mode) {
      case "color":
        newCommand += this.color;
        break;
      case "pencil_begin":
      case "pencil_end":
        break;
      case "point":
      case "line":
        newCommand += `${this.X1.X} ${this.X1.Y} ${this.X2.X} ${this.X2.Y}`;
        break;
      case "circle":
        newCommand += `${this.X1.X} ${this.X1.Y} ${this.R} ${isFilled}`;
        break;
      case "ellipse":
        newCommand += `${this.X1.X} ${this.X1.Y} ${this.A} ${this.B} ${isFilled}`;
        break;
      case "square":
      case "rect":
        newCommand += `${this.X1.X} ${this.X1.Y} ${this.X2.X} ${this.X2.Y} ${isFilled}`;
        break;
      case "tri":
        newCommand += `${this.X1.X} ${this.X1.Y} ${this.X2.X} ${this.X2.Y} ${this.X3.X} ${this.X3.Y} ${isFilled}`;
        break;
      default:
        break;
    }

    console.log("toCommand: " + newCommand);
    return newCommand;
  }
});

function getMousePosition(event) {
  const rect = canvas.getBoundingClientRect();
  
  // 디바이스의 픽셀 비율이 아닌 캔버스의 내부 좌표와 렌더링된 크기의 비율을 계산
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;

  let clientX, clientY;
  if (event.touches && event.touches.length > 0) {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  } else if (event.changedTouches && event.changedTouches.length > 0) {
    clientX = event.changedTouches[0].clientX;
    clientY = event.changedTouches[0].clientY;
  } else {
    clientX = event.clientX;
    clientY = event.clientY;
  }

  const x = (clientX - rect.left) * scaleX;
  const y = (clientY - rect.top) * scaleY;

  return { X: x, Y: y };
}

function mouseListener(event) {
  // 캔버스 내에서의 터치 이벤트만 기본 동작을 막음 (스크롤 방지)
  if (event.cancelable) {
    event.preventDefault();
  }
  
  const eventType = event.type.replace('touch', 'mouse').replace('start', 'down').replace('end', 'up').replace('cancel', 'out');

  switch (eventType) {
    case "mousedown":
      if (!pos.isDraw) {
        pos.mouseDownAction(event);
      }
      break;
    case "mousemove":
      if (pos.isDraw) {
        pos.mouseMoveAction(event);
      }
      break;
    case "mouseup":
    case "mouseout":
      if (pos.isDraw) {
        pos.mouseUpAction(event);
      }
      break;
  }
}

function selectColor(choosedColor) {
  console.log(`selectColor: ${choosedColor}`);
  const colorTableIdx = {
    red: 0,
    orange: 1,
    yellow: 2,
    green: 3,
    blue: 4,
    lightblue: 5,
    lightgreen: 6,
    brown: 7,
    purple: 8,
    pink: 9,
    gray: 10,
    lightgray: 11,
    black: 12,
    white: 13
  };
  pos.color = choosedColor;
  pos.colorIdx = colorTableIdx[choosedColor];

  const newColor = drawCommand();
  newColor.mode = "color";
  newColor.color = choosedColor;
  commandHistory.push(newColor.toCommand());
  addHistory(newColor.toCommand());
}

function selectTool(choosedTool) {
  console.log(choosedTool);
  pos.filled = choosedTool.includes("filled");
  pos.update(toolTable[choosedTool]);
}

function pointMouseDown(event) {
  if (pos.isDraw) {
    return;
  }
  pos.isDraw = true;
  cvs.beginPath();
  cvs.strokeStyle = pos.color;
  var startPos = getMousePosition(event);
  cvs.moveTo(startPos.X, startPos.Y);
  cvs.stroke();
  pos.X = startPos.X;
  pos.Y = startPos.Y;

  const newPoint = drawCommand();
  newPoint.mode = "pencil_begin";
  commandHistory.push(newPoint.toCommand());
  addHistory(newPoint.toCommand());
}

function pointMouseMove(event) {
  var currentPos = getMousePosition(event);

  cvs.lineTo(currentPos.X, currentPos.Y);
  cvs.stroke();

  const newPoint = drawCommand();
  newPoint.mode = "line";
  newPoint.X1 = { X: pos.X, Y: pos.Y };
  newPoint.X2 = { X: currentPos.X, Y: currentPos.Y };
  commandHistory.push(newPoint.toCommand());
  addHistory(newPoint.toCommand());

  pos.X = currentPos.X;
  pos.Y = currentPos.Y;
}

function pointMouseUp(event) {
  if (!pos.isDraw) {
    return;
  }

  pos.isDraw = false;
  cvs.closePath();

  const newPoint = drawCommand();
  newPoint.mode = "pencil_end";
  commandHistory.push(newPoint.toCommand());
  addHistory(newPoint.toCommand());
}

function lineMouseDown(event) {
  console.log("lineMouseDown");
  if (pos.isDraw) {
    return;
  }
  bufCtx.drawImage(canvas, 0, 0);
  var startPos = getMousePosition(event);
  pos.X = startPos.X;
  pos.Y = startPos.Y;
  pos.isDraw = true;
}

function lineMouseMove(event) {
  console.log("lineMouseMove");
  var currentPos = getMousePosition(event);
  cvs.beginPath();
  // Need a delay
  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);

  cvs.strokeStyle = pos.color;
  cvs.moveTo(pos.X, pos.Y);
  cvs.lineTo(currentPos.X, currentPos.Y);
  cvs.closePath();
  cvs.stroke();
}

function lineMouseUp(event) {
  if (!pos.isDraw) {
    return;
  }
  console.log("lineMouseUp");
  var currentPos = getMousePosition(event);
  bufCtx.beginPath();
  bufCtx.strokeStyle = pos.color;
  bufCtx.moveTo(pos.X, pos.Y);
  bufCtx.lineTo(currentPos.X, currentPos.Y);
  bufCtx.closePath();
  bufCtx.stroke();
  cvs.drawImage(bufCanvas, 0, 0);

  const newLine = drawCommand();
  newLine.mode = "line";
  newLine.X1 = { X: pos.X, Y: pos.Y };
  newLine.X2 = { X: currentPos.X, Y: currentPos.Y };
  commandHistory.push(newLine.toCommand());
  addHistory(newLine.toCommand());

  pos.isDraw = false;
}

function circleMouseDown(event) {
  console.log("circleMouseDown");
  if (pos.isDraw) {
    return;
  }
  bufCtx.drawImage(canvas, 0, 0);
  pos.isDraw = true;
  var startPos = getMousePosition(event);
  pos.X = startPos.X;
  pos.Y = startPos.Y;
}

function circleMouseMove(event) {
  console.log("circleMouseMove");
  var currentPos = getMousePosition(event);
  cvs.beginPath();

  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);
  cvs.strokeStyle = "black";

  var circle = {
    X: Math.round((pos.X + currentPos.X) / 2),
    Y: Math.round((pos.Y + currentPos.Y) / 2),
    R: Math.round(Math.abs(currentPos.Y - pos.Y) / 2)
  };

  cvs.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);

  if (pos.filled) {
    cvs.fillStyle = pos.color;
    cvs.fill();
  }

  cvs.closePath();
  cvs.stroke();
  cvs.strokeStyle = pos.color;
}

function circleMouseUp(event) {
  if (pos.isDraw) {
    console.log("lineMouseUp");
    var currentPos = getMousePosition(event);
    bufCtx.beginPath();
    bufCtx.strokeStyle = pos.color;
    var circle = {
      X: Math.round((pos.X + currentPos.X) / 2),
      Y: Math.round((pos.Y + currentPos.Y) / 2),
      R: Math.round(Math.abs(currentPos.Y - pos.Y) / 2)
    };

    bufCtx.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);

    if (pos.filled) {
      bufCtx.fillStyle = pos.color;
      bufCtx.fill();
    }

    bufCtx.closePath();
    bufCtx.stroke();

    cvs.clearRect(0, 0, canvas.width, canvas.height);
    cvs.drawImage(bufCanvas, 0, 0);

    const newCircle = drawCommand();
    newCircle.mode = "circle";
    newCircle.filled = pos.filled;
    newCircle.X1 = { X: circle.X, Y: circle.Y };
    newCircle.R = circle.R;
    commandHistory.push(newCircle.toCommand());
    addHistory(newCircle.toCommand());

    pos.isDraw = false;
  }
}

function squareMouseDown(event) {
  console.log("rectMouseDown");
  if (pos.isDraw) {
    return;
  }
  bufCtx.drawImage(canvas, 0, 0);
  pos.isDraw = true;
  var startPos = getMousePosition(event);
  pos.X = startPos.X;
  pos.Y = startPos.Y;
}

function squareMouseMove(event) {
  console.log("rectMouseMove");
  var currentPos = getMousePosition(event);
  cvs.beginPath();

  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);
  cvs.strokeStyle = "black";

  var box = {
    W: currentPos.Y - pos.Y,
    H: currentPos.Y - pos.Y
  };

  if (pos.filled) {
    cvs.fillStyle = pos.color;
    cvs.fillRect(pos.X, pos.Y, box.W, box.H);
  }

  cvs.strokeRect(pos.X, pos.Y, box.W, box.H);
  cvs.closePath();
  cvs.stroke();
  cvs.strokeStyle = pos.color;
}

function squareMouseUp(event) {
  if (pos.isDraw) {
    console.log("lineMouseUp");
    var currentPos = getMousePosition(event);
    bufCtx.beginPath();
    bufCtx.strokeStyle = pos.color;
    var box = {
      W: currentPos.Y - pos.Y,
      H: currentPos.Y - pos.Y
    };
    if (pos.filled) {
      bufCtx.fillStyle = pos.color;
      bufCtx.fillRect(pos.X, pos.Y, box.W, box.H);
    } else {
      bufCtx.strokeRect(pos.X, pos.Y, box.W, box.H);
    }
    bufCtx.closePath();
    bufCtx.stroke();

    cvs.clearRect(0, 0, canvas.width, canvas.height);
    cvs.drawImage(bufCanvas, 0, 0);

    const newSquare = drawCommand();
    newSquare.mode = "square";
    newSquare.filled = pos.filled;
    newSquare.X1 = { X: pos.X, Y: pos.Y };
    newSquare.X2 = { X: (pos.X + box.H), Y: currentPos.Y };
    commandHistory.push(newSquare.toCommand());
    addHistory(newSquare.toCommand());

    pos.isDraw = false;
  }
}

function rectMouseDown(event) {
  console.log("rectMouseDown");
  if (pos.isDraw) {
    return;
  }
  bufCtx.drawImage(canvas, 0, 0);
  pos.isDraw = true;
  var startPos = getMousePosition(event);
  pos.X = startPos.X;
  pos.Y = startPos.Y;
}

function rectMouseMove(event) {
  console.log("rectMouseMove");
  var currentPos = getMousePosition(event);
  cvs.beginPath();

  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);

  cvs.strokeStyle = "black";
  var box = {
    W: currentPos.X - pos.X,
    H: currentPos.Y - pos.Y
  };

  cvs.strokeRect(pos.X, pos.Y, box.W, box.H);

  if (pos.filled) {
    cvs.fillStyle = pos.color;
    cvs.fillRect(pos.X, pos.Y, box.W, box.H);
  }

  cvs.stroke();
  cvs.closePath();
  cvs.strokeStyle = pos.color;
}

function rectMouseUp(event) {
  if (pos.isDraw) {
    console.log("lineMouseUp");
    var currentPos = getMousePosition(event);
    bufCtx.beginPath();
    bufCtx.strokeStyle = pos.color;
    var box = {
      W: currentPos.X - pos.X,
      H: currentPos.Y - pos.Y
    };
    if (pos.filled) {
      bufCtx.fillStyle = pos.color;
      bufCtx.fillRect(pos.X, pos.Y, box.W, box.H);
    } else {
      bufCtx.strokeRect(pos.X, pos.Y, box.W, box.H);
    }
    bufCtx.closePath();
    bufCtx.stroke();

    cvs.clearRect(0, 0, canvas.width, canvas.height);
    cvs.drawImage(bufCanvas, 0, 0);

    const newRect = drawCommand();
    newRect.mode = "rect";
    newRect.filled = pos.filled;
    newRect.X1 = { X: pos.X, Y: pos.Y };
    newRect.X2 = { X: currentPos.X, Y: currentPos.Y };
    commandHistory.push(newRect.toCommand());
    addHistory(newRect.toCommand());

    pos.isDraw = false;
  }
}

function triMouseDown(event) {
  console.log("triMouseDown");
  if (pos.isDraw) {
    return;
  }
  bufCtx.drawImage(canvas, 0, 0);
  pos.isDraw = true;
  var startPos = getMousePosition(event);
  pos.X = startPos.X;
  pos.Y = startPos.Y;
}

function triMouseMove(event) {
  console.log("triMouseMove");
  var currentPos = getMousePosition(event);

  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);

  var tri = {
    W: currentPos.X - pos.X,
    H: currentPos.Y - pos.Y,
    P: {
      X: pos.X * 2 - currentPos.X,
      Y: currentPos.Y
    }
  };

  cvs.beginPath();
  cvs.strokeStyle = "black";

  cvs.moveTo(pos.X, pos.Y);
  cvs.lineTo(currentPos.X, currentPos.Y);
  cvs.lineTo(tri.P.X, tri.P.Y);
  cvs.lineTo(pos.X, pos.Y);
  cvs.stroke();

  if (pos.filled) {
    cvs.fillStyle = pos.color;
    cvs.fill();
  }

  cvs.closePath();
  cvs.strokeStyle = pos.color;
}

function triMouseUp(event) {
  if (!pos.isDraw) {
      return;
  }
    console.log("triMouseUp");
    var currentPos = getMousePosition(event);

    var tri = {
      W: currentPos.X - pos.X,
      H: currentPos.Y - pos.Y,
      P: {
        X: pos.X * 2 - currentPos.X,
        Y: currentPos.Y
      }
    };

    bufCtx.beginPath();
    bufCtx.strokeStyle = pos.color;

    bufCtx.moveTo(pos.X, pos.Y);
    bufCtx.lineTo(currentPos.X, currentPos.Y);
    bufCtx.lineTo(tri.P.X, tri.P.Y);
    bufCtx.lineTo(pos.X, pos.Y);
    bufCtx.stroke();

    if (pos.filled) {
      bufCtx.fillStyle = pos.color;
      bufCtx.fill();
    }

    cvs.clearRect(0, 0, canvas.width, canvas.height);
    cvs.drawImage(bufCanvas, 0, 0);

    const newTriangle = drawCommand();
    newTriangle.mode = "tri";
    newTriangle.filled = pos.filled;
    newTriangle.X1 = { X: pos.X, Y: pos.Y };
    newTriangle.X2 = { X: currentPos.X, Y: currentPos.Y };
    newTriangle.X3 = { X: tri.P.X, Y: tri.P.Y };
    commandHistory.push(newTriangle.toCommand());
    addHistory(newTriangle.toCommand());

    pos.isDraw = false;
}

function ellipseMouseDown(event) {
  console.log("ellipseMouseDown");
  if (pos.isDraw) {
    return;
  }
  bufCtx.drawImage(canvas, 0, 0);
  pos.isDraw = true;
  var startPos = getMousePosition(event);
  pos.X = startPos.X;
  pos.Y = startPos.Y;
}

function ellipseMouseMove(event) {
  console.log("ellipseMouseMove");
  var currentPos = getMousePosition(event);
  cvs.beginPath();

  cvs.clearRect(0, 0, canvas.width, canvas.height);
  cvs.drawImage(bufCanvas, 0, 0);
  cvs.strokeStyle = "black";

  var ellipse = {
    X: Math.round((pos.X + currentPos.X) / 2),
    Y: Math.round((pos.Y + currentPos.Y) / 2),
    A: Math.round(Math.abs(currentPos.X - pos.X) / 2),
    B: Math.round(Math.abs(currentPos.Y - pos.Y) / 2)
  };

  cvs.ellipse(ellipse.X, ellipse.Y, ellipse.A, ellipse.B, 0, 0, 2 * Math.PI);

  if (pos.filled) {
    cvs.fillStyle = pos.color;
    cvs.fill();
  }

  cvs.closePath();
  cvs.stroke();
  cvs.strokeStyle = pos.color;
}

function ellipseMouseUp(event) {
  if (pos.isDraw) {
    console.log("ellipseMouseUp");
    var currentPos = getMousePosition(event);
    bufCtx.beginPath();
    bufCtx.strokeStyle = pos.color;
  var ellipse = {
    X: Math.round((pos.X + currentPos.X) / 2),
    Y: Math.round((pos.Y + currentPos.Y) / 2),
    A: Math.round(Math.abs(currentPos.X - pos.X) / 2),
    B: Math.round(Math.abs(currentPos.Y - pos.Y) / 2)
  };

    bufCtx.ellipse(ellipse.X, ellipse.Y, ellipse.A, ellipse.B, 0, 0, 2 * Math.PI);

    if (pos.filled) {
      bufCtx.fillStyle = pos.color;
      bufCtx.fill();
    }

    bufCtx.closePath();
    bufCtx.stroke();

    cvs.clearRect(0, 0, canvas.width, canvas.height);
    cvs.drawImage(bufCanvas, 0, 0);

    const newEllipse = drawCommand();
    newEllipse.mode = "ellipse";
    newEllipse.filled = pos.filled;
    newEllipse.X1 = { X: ellipse.X, Y: ellipse.Y };
    newEllipse.A = ellipse.A;
    newEllipse.B = ellipse.B;
    commandHistory.push(newEllipse.toCommand());
    addHistory(newEllipse.toCommand());

    pos.isDraw = false;
  }
}

function saveImage() {
  console.log("saveImage()");
  let imageName = document.getElementById("title").value.trim();
  console.log(imageName.length);
  if (imageName.length === 0) {
    imageName = "image";
  }
  imageName += ".png";

  const image = document
    .getElementById("canvas")
    .toDataURL("image/png")
    .replace("image/png", "image/octet-stream");

  const link = document.createElement("a");
  link.setAttribute("download", imageName);
  link.setAttribute("href", image);
  link.click();
}

function addHistory(cmd) {
  let history = document.getElementById("history").value;
  history += cmd.trim() + "\n";
  document.getElementById("history").value = history;
}

function clearCanvas() {
  console.log("clearCanvas()");
  cvs.clearRect(0, 0, canvas.width, canvas.height);
  bufCtx.clearRect(0, 0, canvas.width, canvas.height);
}

function initHistory() {
  commandHistory = [];
  redoHistory = [];

  document.getElementById("history").value = "";

  const newColor = drawCommand();
  newColor.mode = "color";
  newColor.color = "red";
  commandHistory.push(newColor.toCommand());
  addHistory(newColor.toCommand());
}

function showHistory() {
  console.log("showHistory()");
  const historyEl = document.getElementById("history");
  historyEl.style.display = historyEl.style.display === "none" ? "block" : "none";
}

function undo() {
  console.log("undo");

  if (commandHistory.length <= 1) {
    return;
  }

  let lastCommand = commandHistory.pop();
  redoHistory.push(lastCommand);

  if (lastCommand.trim() === "pencil_end") {
    console.log("Start remove pencil group");
    while (commandHistory.length > 1) {
       lastCommand = commandHistory.pop();
       lastCommand = lastCommand.trim();
       if (lastCommand.length === 0) {
         continue;
       }
       redoHistory.push(lastCommand);
       if (lastCommand.trim() === "pencil_begin") {
         break;
       }
    }
  }

  let history = "";

  commandHistory.forEach(e => {
    history += e + "\n";
  });

  document.getElementById("history").value = history;
  clearCanvas();
  drawengine(canvas, cvs, bufCanvas, bufCtx, commandHistory);
}

function redo() {
  console.log("redo");

  if (redoHistory.length === 0) {
    return;
  }

  let lastCommand = redoHistory.pop();
  commandHistory.push(lastCommand);
  addHistory(lastCommand);

  if (lastCommand.trim() === "pencil_begin") {
    console.log("Start add pencil group");
    let history = "";
    while (redoHistory.length > 0) {
       lastCommand = redoHistory.pop();
       if (lastCommand.length === 0) {
          continue;
       }
       history += lastCommand.trim() + "\n";
       commandHistory.push(lastCommand);
       if (lastCommand.trim() === "pencil_end") {
         break;
       }
    }
    addHistory(history);
  }

  clearCanvas();
  drawengine(canvas, cvs, bufCanvas, bufCtx, commandHistory);
}

function initPage() {
  console.log("initPage()");

  clearCanvas();
  initHistory();
}

function reDrawCanvas() {
  console.log("reDrawCanvas");
  clearCanvas();
  commandHistory = [];

  commandHistory = document.getElementById("history").value.split('\n');

  drawengine(canvas, cvs, bufCanvas, bufCtx, commandHistory);
}

function setupEventListeners() {
  // Mouse events
  canvas.addEventListener("mousedown", mouseListener);
  canvas.addEventListener("mousemove", mouseListener);
  canvas.addEventListener("mouseout", mouseListener);
  canvas.addEventListener("mouseup", mouseListener);

  // Touch events for mobile
  canvas.addEventListener("touchstart", mouseListener, { passive: false });
  canvas.addEventListener("touchmove", mouseListener, { passive: false });
  canvas.addEventListener("touchend", mouseListener, { passive: false });
  canvas.addEventListener("touchcancel", mouseListener, { passive: false });

  // Toolbar event delegation
  document.querySelector('.toolbar').addEventListener('click', (e) => {
    const img = e.target.closest('img');
    if (!img) return;

    const action = img.dataset.action;
    const value = img.dataset.value;

    if (action === 'color') {
      selectColor(value);
    } else if (action === 'tool') {
      selectTool(value);
    } else if (action === 'undo') {
      undo();
    } else if (action === 'redo') {
      redo();
    }
  });

  // Button events
  document.getElementById('load_filename').addEventListener('change', loadFile);
  document.getElementById('saveImageBtn').addEventListener('click', saveImage);
  document.getElementById('clearBtn').addEventListener('click', initPage);
  document.getElementById('historyBtn').addEventListener('click', showHistory);
  document.getElementById('saveJsonBtn').addEventListener('click', SaveAsJson);
  document.getElementById('saveTxtBtn').addEventListener('click', SaveAsTxt);
  document.getElementById('redrawBtn').addEventListener('click', reDrawCanvas);
}

function resizeCanvas() {
  const container = document.querySelector('.canvas-container');
  const containerWidth = container.clientWidth;
  
  // 기본 내부 해상도 720x720
  const canvasInternalSize = 720;

  // 화면 너비에 맞춰 캔버스의 표시 크기 조정
  // padding 등을 고려하여 여유 공간 확보 (body padding 10px * 2)
  const availableWidth = containerWidth - 10;
  const displaySize = Math.min(availableWidth, canvasInternalSize);

  canvas.style.width = displaySize + 'px';
  canvas.style.height = displaySize + 'px';

  // 실제 캔버스의 내부 해상도는 720x720으로 고정하여 그림의 질 유지
  if (canvas.width !== canvasInternalSize || canvas.height !== canvasInternalSize) {
    canvas.width = canvasInternalSize;
    canvas.height = canvasInternalSize;
    bufCanvas.width = canvasInternalSize;
    bufCanvas.height = canvasInternalSize;
  }
}

function onLoadPage() {
  canvas = document.getElementById("canvas");
  cvs = canvas.getContext("2d");

  bufCanvas = document.createElement("canvas");
  bufCanvas.width = canvas.width;
  bufCanvas.height = canvas.height;
  bufCtx = bufCanvas.getContext("2d");

  resizeCanvas();
  setupEventListeners();
  initPage();

  // 화면 크기 변경 시 캔버스 크기 재조정
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const oldCommands = [...commandHistory];
      resizeCanvas();
      clearCanvas();
      drawengine(canvas, cvs, bufCanvas, bufCtx, oldCommands);
    }, 250);
  });
}

window.addEventListener('DOMContentLoaded', onLoadPage);
