var cvs;
var canvas;

var bufCanvas;
var bufCtx;

var paintMode = [
    "point",
    "line",
    "circle",
    "filledcircle",
    "square",
    "filledsquare",
    "rect",
    "filledrect"
];

var toolTable = {
    'pencil' : 0,
    'line' : 1,
    'circle' : 2,
    'filledcircle': 3,
    'square': 4,
    'filledsquare' : 5,
    'rect': 6,
    'filledrect': 7
};

var paintMouseDownAction = {
    "point" : pointMouseDown, 
    "line" : lineMouseDown,
    "circle" : circleMouseDown,
    "filledcircle" : circleMouseDown,
    "square" : squareMouseDown,
    "filledsquare" : squareMouseDown,
    "rect" : rectMouseDown,
    "filledrect" : rectMouseDown
};

var paintMouseUpAction = {
    "point" : pointMouseUp, 
    "line" : lineMouseUp,
    "circle" : circleMouseUp,
    "filledcircle" : circleMouseUp,
    "square" : squareMouseUp,
    "filledsquare" : squareMouseUp,
    "rect" : rectMouseUp,
    "filledrect" : rectMouseUp
};

var paintMouseMoveAction = {
    "point" : pointMouseMove, 
    "line" : lineMouseMove,
    "circle" : circleMouseMove,
    "filledcircle" : circleMouseMove,
    "square" : squareMouseMove,
    "filledsquare" : squareMouseMove,
    "rect" : rectMouseMove,
    "filledrect" : rectMouseMove,
};

var pos = {
    isDraw : false,
    color : "red",
    colorIdx : 0,
    drawMode : 0,
    filled : false,
    mouseDownAction : paintMouseDownAction[paintMode[0]],
    mouseUpAction : paintMouseUpAction[paintMode[0]],
    mouseMoveAction : paintMouseMoveAction[paintMode[0]],
    x : 0,
    y : 0,
    update : function(drawMode) {
        this.drawMode = drawMode;
        this.mouseDownAction = paintMouseDownAction[paintMode[drawMode]];
        this.mouseUpAction = paintMouseUpAction[paintMode[drawMode]];
        this.mouseMoveAction = paintMouseMoveAction[paintMode[drawMode]];
    }
};

function getMousePosition(event) {
    var x = event.pageX - canvas.offsetLeft;
    var y = event.pageY - canvas.offsetTop;
    return {X:x, Y:y};
}

function getMousePositionOfTool(event) {
    var x = event.pageX - painter_tool.offsetLeft;
    var y = event.pageY - painter_tool.offsetTop;
    return {X:x, Y:y};
}

function mouseListener(event) {
    switch(event.type) {
        case "mousedown":
           pos.mouseDownAction(event);
           break;
        case "mousemove":
           if (pos.isDraw) {
               pos.mouseMoveAction(event);
           }
           break;
        case "mouseup":
        case "mouseout":
           pos.mouseUpAction(event);
           break;
    }
}


function selectColor(choosedColor) {
    console.log("selectColor:" + choosedColor);
    var colorTableIdx = {'red': 0, 'orange':1, 'yellow':2, 'green':3, 'blue':4, 'lightblue':5, 'lightgreen':6, 'brown':7,
                     'purple':8, 'pink':9, 'gray':10, 'lightgray':11, 'black':12, 'white':13};
    pos.color = choosedColor;
    pos.colorIdx = colorTableIdx[choosedColor];
}

function selectTool(choosedTool) {
    console.log(choosedTool);
    if (choosedTool.indexOf("filled") != -1) {
        pos.filled = true;
    } else {
        pos.filled = false;
    }
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
}

function pointMouseMove(event) {
    var currentPos = getMousePosition(event);
    cvs.lineTo(currentPos.X, currentPos.Y);
    cvs.stroke();
}

function pointMouseUp(event) {
    pos.isDraw = false;
    cvs.closePath();
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
    if (pos.isDraw) {
        console.log("lineMouseUp");
        var currentPos = getMousePosition(event);
        bufCtx.beginPath();
        bufCtx.strokeStyle = pos.color;
        bufCtx.moveTo(pos.X, pos.Y);
        bufCtx.lineTo(currentPos.X, currentPos.Y);
        bufCtx.closePath();
        bufCtx.stroke();
        cvs.drawImage(bufCanvas, 0, 0);
        pos.isDraw = false;
    }
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
    // Need a delay
    cvs.clearRect(0, 0, canvas.width, canvas.height);
    cvs.drawImage(bufCanvas, 0, 0);
    cvs.strokeStyle = pos.color;
    var circle = {
        X : (pos.X + currentPos.X)/ 2,
        Y : (pos.Y + currentPos.Y)/ 2,
        R : Math.abs(currentPos.Y - pos.Y) / 2
    };

    if (pos.filled) {
        cvs.fillStyle = pos.color;
        cvs.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);
        cvs.fill();
    } else {
        cvs.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);
    }
    cvs.closePath();
    cvs.stroke();
}

function circleMouseUp(event) {
    if (pos.isDraw) {
        console.log("lineMouseUp");
        var currentPos = getMousePosition(event);
        bufCtx.beginPath();
        bufCtx.strokeStyle = pos.color;
        var circle = {
            X : (pos.X + currentPos.X)/ 2,
            Y : (pos.Y + currentPos.Y)/ 2,
            R : Math.abs(currentPos.Y - pos.Y) / 2
        };
        if (pos.filled) {
            bufCtx.fillStyle = pos.color;
            bufCtx.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);
            bufCtx.fill();
        } else {
            bufCtx.arc(circle.X, circle.Y, circle.R, 0, Math.PI * 2);
        }
        bufCtx.closePath();
        bufCtx.stroke();
        cvs.drawImage(bufCanvas, 0, 0);
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
    // Need a delay
    cvs.clearRect(0, 0, canvas.width, canvas.height);
    cvs.drawImage(bufCanvas, 0, 0);
   
    cvs.strokeStyle = pos.color;
    var box = {
        W : currentPos.Y - pos.Y,
        H : currentPos.Y - pos.Y
    }
    if (pos.filled) {
        cvs.fillStyle = pos.color;
        cvs.fillRect(pos.X, pos.Y, box.W, box.H);
    } else {
        cvs.strokeRect(pos.X, pos.Y, box.W, box.H);
    }
    cvs.closePath();
    cvs.stroke();
}

function squareMouseUp(event) {
    if (pos.isDraw) {
        console.log("lineMouseUp");
        var currentPos = getMousePosition(event);
        bufCtx.beginPath();
        bufCtx.strokeStyle = pos.color;
        var box = {
            W : currentPos.Y - pos.Y,
            H : currentPos.Y - pos.Y
        }
        if (pos.filled) {
            bufCtx.fillStyle = pos.color;
            bufCtx.fillRect(pos.X, pos.Y, box.W, box.H);
        } else {
            bufCtx.strokeRect(pos.X, pos.Y, box.W, box.H);
        }
        bufCtx.closePath();
        bufCtx.stroke();
        cvs.drawImage(bufCanvas, 0, 0);
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
    // Need a delay
    cvs.clearRect(0, 0, canvas.width, canvas.height);
    cvs.drawImage(bufCanvas, 0, 0);
   
    cvs.strokeStyle = pos.color;
    var box = {
        W : currentPos.X - pos.X,
        H : currentPos.Y - pos.Y
    }

    if (pos.filled) {
        cvs.fillStyle = pos.color;
        cvs.fillRect(pos.X, pos.Y, box.W, box.H);
    } else {
        cvs.strokeRect(pos.X, pos.Y, box.W, box.H);
    }
    cvs.closePath();
    cvs.stroke();
}

function rectMouseUp(event) {
    if (pos.isDraw) {
        console.log("lineMouseUp");
        var currentPos = getMousePosition(event);
        bufCtx.beginPath();
        bufCtx.strokeStyle = pos.color;
        var box = {
            W : currentPos.X - pos.X,
            H : currentPos.Y - pos.Y
        }
        if (pos.filled) {
            bufCtx.fillStyle = pos.color;
            bufCtx.fillRect(pos.X, pos.Y, box.W, box.H);
        } else {
            bufCtx.strokeRect(pos.X, pos.Y, box.W, box.H);
        }
        bufCtx.closePath();
        bufCtx.stroke();
        cvs.drawImage(bufCanvas, 0, 0);
        pos.isDraw = false;
    }
}

function saveImage() {
    console.log("saveImage()");
    var imageName = document.getElementById("title").value;
    console.log(imageName.lenght);
    if (imageName.length == 0) {
        imageName = "image";
    }
    imageName += ".png";
    var saveedImage = document.getElementById("saveImage");
    var image = document.getElementById("canvas").toDataURL("image/png")
                .replace("image/png", "image/octet-stream");
    saveedImage.setAttribute("download", imageName);    
    saveedImage.setAttribute("href", image);
}

function clearCanvas() {
    console.log("clearCanvas()");
    cvs.clearRect(0, 0, canvas.width, canvas.height);
    bufCtx.clearRect(0, 0, canvas.width, canvas.height);
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
}

window.onload = onLoadPage();

