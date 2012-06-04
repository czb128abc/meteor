/** Blade Run-time helper functions
	(c) Copyright 2012. Blake Miner. All rights reserved.	
	https://github.com/bminer/node-blade
	http://www.blakeminer.com/
	
	See the full license here:
		https://raw.github.com/bminer/node-blade/master/LICENSE.txt
*/
(function() {
	var runtime = typeof exports == "object" ? exports : {};
	var cachedViews = {};
	if(runtime.client = typeof window != "undefined")
		window.blade = {'runtime': runtime, 'cachedViews': cachedViews, 'cb': {}, 'rootURL': '/views'};

	runtime.escape = function(str) {
		return str == null ? "" : new String(str)
			.replace(/&(?!\w+;)/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}
	
	runtime.attrs = function(attrs, buf) {
		for(var i in attrs)
		{
			if(attrs[i].val == null)
			{
				if(attrs[i].append != null)
				{
					attrs[i].val = attrs[i].append;
					delete attrs[i].append;
				}
				else
					continue;
			}
			if(i == "class")
			{
				if(attrs[i].val instanceof Array)
					attrs[i].val = attrs[i].val.join(" ");
				if(attrs[i].append)
					attrs[i].val = (attrs[i].val.length > 0 ? attrs[i].val + " " : "") + attrs[i].append;
			}
			if(attrs[i].escape)
				buf.push(" " + i + "=\"" + runtime.escape(attrs[i].val) + "\"");
			else
				buf.push(" " + i + "=\"" + attrs[i].val + "\"");
		}
	}
	
	/* Load the template from a file
		Default behavior in Node.JS is to compile the file using Blade.
		Default behavior in browser is to load async using a script tag.
		loadTemplate(baseDir, filename, [compileOptions,] cb)
		or
		loadTemplate(filename, [compileOptions,] cb)
	*/
	runtime.loadTemplate = function(baseDir, filename, compileOptions, cb) {
		//Reorganize arguments
		if(typeof compileOptions == "function")
		{
			cb = compileOptions;
			if(typeof filename == "object")
				compileOptions = filename, filename = baseDir, baseDir = "";
			else
				compileOptions = null;
		}
		if(typeof filename == "function")
			cb = filename, filename = baseDir, compileOptions = null, baseDir = "";
		//Arguments are now in the right place
		if(runtime.client)
		{
			filename = runtime.resolve(filename);
			if(cachedViews[filename])
				return cb(null, cachedViews[filename]);
			var blade = window.blade;
			if(blade.cb[filename])
				throw new Error("Template is already loading. Be patient.");
			var st = document.createElement('script');
			st.type = 'application/javascript';
			st.async = true;
			st.src = blade.rootURL + '/' + filename;
			var s = document.getElementsByTagName('script')[0];
			s.parentNode.insertBefore(st, s);
			var timer = setTimeout(function() {
				delete blade.cb[filename];
				st.parentNode.removeChild(st);
				cb(new Error("Timeout Error: Blade Template [" + filename +
					"] could not be loaded.") );
			}, 15000);
			blade.cb[filename] = function(ns) {
				clearTimeout(timer);
				delete blade.cb[filename];
				st.parentNode.removeChild(st);
				cb(null, ns[filename]);
			};
		}
		else
		{
			var blade = require('./blade');
			blade.compileFile(baseDir + "/" + filename, compileOptions, function(err, wrapper) {
				if(err) return cb(err);
				cb(null, wrapper.template);
			});
		}
	}
	
	//This function is a hack to get the resolved URL, so that caching works okay with relative URLs
	runtime.resolve = function(filename) {
		if(runtime.client) {
			var x = document.createElement('div');
			x.innerHTML = '<a href="' + runtime.escape("./" + filename) + '"></a>';
			x = x.firstChild.href;
			x = x.substr(window.location.href.length).replace(/\/\//g, '/');
			if(x.charAt(0) == '/') x = x.substr(1);
			return x;
		}
	};
	
	runtime.include = function(relFilename, info, cb) {
		var include = info.inc,
			pFilename = info.filename,
			pBase = info.base,
			pRel = info.rel,
			pLine = info.line,
			pCol = info.col,
			pSource = info.source;
		function includeDone(err, html) {
			if(!include) info.inc = false;
			info.filename = pFilename;
			info.base = pBase;
			info.rel = pRel;
			info.line = pLine;
			info.col = pCol;
			info.source = pSource;
			cb(err);
		}
		info.inc = true;
		//Append .blade for filenames without an extension
		var ext = relFilename.split("/");
		ext = ext[ext.length-1].indexOf(".");
		if(ext < 0)
			relFilename += ".blade";
		//Now load the template and render it
		runtime.loadTemplate(info.base, info.rel + "/" + relFilename,
			runtime.compileOptions, function(err, tmpl) {
				if(err) return cb(err);
				tmpl(info.locals, includeDone, info);
		});
	}
	
	runtime.capture = function(buf, info) {
		var start = info.pos;
		//Delete all blocks defined within the function
		for(var i in buf.blocks)
			if(buf.blocks[i].pos >= start)
				delete buf.blocks[i];
		/* Now remove the content generated by the function from the buffer
			and return it as a string */
		return buf.splice(start, buf.length - start).join("");
	};
	
	runtime.chunk = function(name, func, info) {
		info.chunk[name] = function() {
			//This function needs to accept params and return HTML
			return runtime.capture(info,
				func.apply({'pos': info.length}, arguments) );
		};
	};
	
	runtime.blockDef = function(blockName, buf, childFunc) {
		var block = buf.blocks[blockName] = {
			'parent': buf.block || null,
			'buf': [],
			'pos': buf.length,
			'numChildren': 0
		};
		//Copy properties from buf into block.buf
		var copy = ['r', 'blocks', 'func', 'locals', 'cb'];
		for(var i in copy)
			block.buf[copy[i]] = buf[copy[i]];
		block.buf.block = block;
		//Update numChildren in parent block
		if(block.parent)
			block.parent.numChildren++;
		//Leave a spot in the buffer for this block
		buf.push('');
		//If parameterized block
		if(childFunc.length > 1)
			block.paramBlock = childFunc;
		else
		{
			try {childFunc(block.buf); }
			catch(e) {buf.line = block.buf.line, buf.col = block.buf.col; throw e;}
		}
		return block;
	};
	
	runtime.blockRender = function(type, blockName, buf) {
		var block = buf.blocks[blockName];
		if(block == null)
			throw new Error("Block '" + blockName + "' is undefined.");
		if(block.paramBlock == null)
			throw new Error("Block '" + blockName +
				"' is a regular, non-parameterized block, which cannot be rendered.");
		//Extract arguments
		var args = [block.buf];
		for(var i = 3; i < arguments.length; i++)
			args[i-2] = arguments[i];
		if(type == "r") //replace
			block.buf.length = 0; //empty the array (this is an accepted approach, btw)
		var start = block.buf.length;
		//Render the block
		try{block.paramBlock.apply(this, args);}
		catch(e) {buf.line = block.buf.line, buf.col = block.buf.col; throw e;}
		if(type == "p")
			prepend(block, buf, start);
	}
	
	/* Take recently appended content and prepend it to the block, fixing any
		defined block positions, as well. */
	function prepend(block, buf, start) {
		var prepended = block.buf.splice(start, block.buf.length - start);
		Array.prototype.unshift.apply(block.buf, prepended);
		//Fix all the defined blocks, too
		for(var i in buf.blocks)
			if(buf.blocks[i].parent == block && buf.blocks[i].pos >= start)
				buf.blocks[i].pos -= start;
	}
	
	runtime.blockMod = function(type, blockName, buf, childFunc) {
		var block = buf.blocks[blockName];
		if(block == null)
			throw new Error("Block '" + blockName + "' is undefined.");
		if(type == "r") //replace
		{
			//Empty buffer and delete parameterized block function
			delete block.paramBlock;
			block.buf.length = 0; //empty the array (this is an accepted approach, btw)
		}
		var start = block.buf.length;
		//If parameterized block (only works for type == "r")
		if(childFunc.length > 1)
			block.paramBlock = childFunc;
		else
		{
			try {childFunc(block.buf);}
			catch(e) {buf.line = block.buf.line, buf.col = block.buf.col; throw e;}
		}
		if(type == "p") //prepend
			prepend(block, buf, start);
	};
	
	/* Although runtime.done looks like a O(n^2) operation, I think it is
		O(n * max_block_depth) where n is the number of blocks. */
	runtime.done = function(buf) {
		//Iterate through each block until done
		var done = false;
		while(!done)
		{
			done = true; //We are done unless we find work to do
			for(var i in buf.blocks)
			{
				var x = buf.blocks[i];
				if(!x.done && x.numChildren == 0)
				{
					//We found work to do
					done = false;
					//Insert the buffer contents where it belongs
					if(x.parent == null)
						buf[x.pos] = x.buf.join("");
					else
					{
						x.parent.buf[x.pos] = x.buf.join("");
						x.parent.numChildren--;
					}
					x.done = true;
				}
			}
		}
	};
	
	runtime.rethrow = function(err, info) {
		if(info == null)
			info = err;
		//prevent the same error from appearing twice
		if(err.lastFilename == info.filename && err.lastFilename != null)
			return err;
		info.column = info.column || info.col;
		//Generate error message
		var msg = err.message + "\n    at " +
			(info.filename == null ? "<anonymous>" : info.filename) + 
			(info.line == null ? "" : ":" + info.line +
				(info.column == null ? "" : ":" + info.column) );
		if(info.source != null)
		{
			const LINES_ABOVE_AND_BELOW = 3;
			var lines = info.source.split("\n"),
				start = Math.max(info.line - LINES_ABOVE_AND_BELOW, 0),
				end = Math.min(info.line + LINES_ABOVE_AND_BELOW, lines.length),
				digits = new String(end).length;
			lines = lines.slice(start, end);
			msg += "\n\n";
			for(var i = 0; i < lines.length; i++)
				msg += pad(i + start + 1, digits) +
					(i + start + 1 == info.line ? ">\t" : "|\t") +
					lines[i] + "\n";
		}
		err.message = msg;
		err.lastFilename = info.filename;
		//Only set these properties once
		if(err.filename == null && err.line == null)
		{
			err.filename = info.filename;
			err.line = info.line;
			err.column = info.column;
		}
		return err;
	};
	
	//A rather lame implementation, but it works
	function pad(number, count) {
		var str = number + " ";
		for(var i = 0; i < count - str.length + 1; i++)
			str = " " + str;
		return str;
	}
})();