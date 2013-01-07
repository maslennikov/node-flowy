'use strict';

/**
 * Group serves as a modified version of CommonJS promise which allows deferring
 * asynchronous code execution until each of the group's slots is resolved.
 *
 * The main feature of the Group is that it handles multiple simultaneous
 * asynchronous processes while promise handles only one async process at a time.
 *
 * To make it possible, Group defines a term `slot` meaning one deferred result
 * of the async execution. You can imagine Group's slots as an array of
 * promises that are resolving concurrently. When all slots are resolved, their
 * results are passed to the callback of the group, in the nodejs-style:
 *   callback(err, slot1, slot2, ...);
 *
 * The Group breaks also becomes resolved when the first error occures during
 * the resolving each of its slots.
 */


function slice() {
    var fn = Array.prototype.slice;
    return fn.call.apply(fn, arguments);
}

/**
 * @param {function(args)} [body]
 *   a body of the group to be executed within its context
 */
function Group() {
    this.resolved = false;
    this.slots = [null];        //first slot represents error status
    this.reservedSlots = 0;
    this.callbacks = [];
}

Group.chain = function(fn /*, arg1, ..., argN*/) {
    var group = new Group();
    return group.fcall.apply(group, arguments);
};

/**
 * Execute given function in the context of the group.
 *
 * @param {function} fn
 *   A function to be called within the context of the group that
 *   might reserve some slots of the group. The value returned by
 *   the `fn` will be ignored.
 * @param {misc} arg1...argN
 *   arguments to be passed to the `fn`
 *
 * @return group itself
 */
Group.prototype.fcall = function(fn /*, arg1, ..., argN*/) {
    try {
        fn.apply(this, slice(arguments, 1));
    } catch(e) {
        this.error(e);
    } finally {
        return this;
    }
};

Group.prototype.fapply = function(fn, args) {
    return Group.prototype.fcall.apply(this,
        [fn].concat(slice(args || [])));
};

Group.prototype.then = function(callback) {
    this._queueCallback(callback);
};


/**
 * Reserve one slot in the arguments array to be passed
 * to the group's callback. Group's callback will not be called until
 * all reserved slots are filled with data or the error occures.
 *
 * @return {function(err, data)} callback to fill the slot with data
 */
Group.prototype.slot = function slot() {
    var self = this;
    var slot = self._reserveSlot();
    return function(err, data) {
        process.nextTick(function() {
            if (err) {
                return self.error(err);
            }
            self._fillSlot(slot, data);
        });
    };
};

/**
 * Creates a nested group, all results of which will be put
 * into the reserved slot as a single array.
 */
Group.prototype.makeGroup = function makeGroup() {
    var callback = this.slot();
    var group = new Group();
    group.then(function (err) {
        var data = slice(arguments, 1);
        callback(err, data);
    });
    return group;
};

/**
 * Wrapper for passing synchronous values to the next step
 */
Group.prototype.pass = function pass(/*values*/) {
    var values = slice(arguments);
    for (var i = 0, l = values.length; i < l; i++) {
        this.slot()(null, values[i]);
    }
};

Group.prototype.error = function(err) {
    this._resolve(err);
};


/**
 * Reserve space for one argument in the `slots` array.
 * @return {Number} index of the reserved slot
 */
Group.prototype._reserveSlot = function() {
    this.reservedSlots++;
    return this.slots.push(undefined) - 1;
};

/**
 * Fill the reserved slot addressed by `index` with the given `value`.
 */
Group.prototype._fillSlot = function(index, data) {
    this.slots[index] = data;
    if (!--this.reservedSlots) {
        this._resolve();
    }
};

Group.prototype._resolve = function(err) {
    if (this.resolved) return;
    this.resolved = true;
    this.slots[0] = err;
    while (this.callbacks.length) {
        this._triggerCallback(this.callbacks.shift());
    }
};


Group.prototype._queueCallback = function(callback) {
    if (!this.resolved) {
        this.callbacks.push(callback);
    } else {
        this._triggerCallback(callback);
    }
};

Group.prototype._triggerCallback = function(callback) {
    callback.apply(null, this.slots);
};


module.exports.Group = Group;