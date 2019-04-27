function drawengine(targetCanvas, tarageCtx,  targetBufCanvas, targeBufctx, cmdList) {
    console.log("drawengine()");

    cmdList.forEach(function(e) {
        // console.log(e);
        var cmd = e.split(' ');
        // console.log(cmd);
        processCmd(cmd, targeBufctx);
    });

    /*

    targeBufctx.beginPath();

    targeBufctx.strokeStyle = pos.color;

    bufCtx.moveTo(pos.X, pos.Y);
    bufCtx.lineTo(currentPos.X, currentPos.Y);
    bufCtx.lineTo(tri.P.X, tri.P.Y);
    bufCtx.lineTo(pos.X, pos.Y);
    bufCtx.stroke();

    if (pos.filled) {
      bufCtx.fillStyle = pos.color;
      bufCtx.fill();
    } 
    targeBufctx.closePath();


    */

   tarageCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
   tarageCtx.drawImage(targetBufCanvas, 0, 0);
}

var drawCmdTable = {
    color:processColor,
    line:processLine,
    circle:processCircle,
    rect:processRect,
    square:processRect,
    tri:processTri
}

var enginePos = {
    color: "red",
    filled: false,
}

function processColor(cmd, targeBufctx) {
    console.log("processColor");
    enginePos.color = cmd[1];
}

function processLine(cmd, targeBufctx) {
    console.log("processLine");
    targeBufctx.beginPath();

    targeBufctx.strokeStyle = enginePos.color;

    var X1 = {
        X:parseInt(cmd[1]),
        Y:parseInt(cmd[2])
    }
    
    var X2= {
        X:parseInt(cmd[3]),
        Y:parseInt(cmd[4])   
    }

    targeBufctx.moveTo(X1.X, X1.Y);
    targeBufctx.lineTo(X2.X, X2.Y);
    targeBufctx.stroke();

    targeBufctx.closePath();
}

function processCircle(cmd, targeBufctx) {
    console.log("processCircle");
}

function processRect(cmd, targeBufctx) {
    console.log("processRect");

    targeBufctx.beginPath();

    targeBufctx.strokeStyle = enginePos.color;

    var X1 = {
        X:parseInt(cmd[1]),
        Y:parseInt(cmd[2])
    }
    
    var X2= {
        X:parseInt(cmd[3]),
        Y:parseInt(cmd[4])   
    }

    var filled = (cmd[5] == 'F') ? true : false;

    var box = {
        W: X2.X - X1.X,
        H: X2.Y - X1.Y
    };
    
    if (filled) {
        targeBufctx.fillStyle = enginePos.color;
        targeBufctx.fillRect(X1.X, X1.Y, box.W, box.H);
    } else {
        targeBufctx.strokeRect(X1.X, X1.Y, box.W, box.H);
    }

    targeBufctx.closePath();
}

function processTri(cmd, targeBufctx) {
    console.log("processTri");
}

function processCmd(cmd, targeBufctx) {
    console.log("processCmd: " + cmd[0]);
    drawCmdTable[cmd[0]](cmd, targeBufctx);   
}