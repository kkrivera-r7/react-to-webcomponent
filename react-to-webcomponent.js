const reactComponentSymbol = Symbol.for('r2wc.reactComponent');
const renderSymbol = Symbol.for('r2wc.reactRender');
const shouldRenderSymbol = Symbol.for('r2wc.shouldRender');
const connectedSymbol = Symbol.for('r2wc.connected');

const define = {
	// Creates a getter/setter that re-renders every time a property is set.
	expando: function (receiver, key, value) {
		Object.defineProperty(receiver, key, {
			enumerable: true,
			get: function () {
				return value;
			},
			set: function (newValue) {
				value = newValue;
				this[renderSymbol]();
			},
		});
		receiver[renderSymbol]();
	},
};

let count = 0;
function wrapDomEleInComponent(value, React) {
	return React.createElement(
		function ({ value }) {
			const ref = React.createRef();

			// After dom element is ready
			React.useEffect(() => {
				const { current: ele } = ref;
				value.forEach((childNode) => {
					ele.parentNode.append(childNode);
				});

				// Clean up template container
				ele.remove();
			});

			return <template ref={ref}></template>;
		},
		{ key: `dynamicElement${count++}`, value }
	);
}

/**
 * Converts a React component into a webcomponent by wrapping it in a Proxy object.
 * @param {ReactComponent}
 * @param {React}
 * @param {ReactDOM}
 * @param {Object} options - Optional parameters
 * @param {String?} options.shadow - Use shadow DOM rather than light DOM.
 */
export default function (ReactComponent, React, ReactDOM, options = {}) {
	// Warn if there are no propTypes defined
	if (!ReactComponent.propTypes) {
		console.warn(`No propTypes found on ${ReactComponent.name} component`);
	}

	const renderAddedProperties = { isConnected: 'isConnected' in HTMLElement.prototype };
	let rendering = false;
	// Create the web component "class"
	const WebComponent = function () {
		const self = Reflect.construct(HTMLElement, arguments, this.constructor);
		if (options.shadow) {
			self.attachShadow({ mode: 'open' });
		}

		return self;
	};

	// Make the class extend HTMLElement
	const targetPrototype = Object.create(HTMLElement.prototype);
	targetPrototype.constructor = WebComponent;

	// But have that prototype be wrapped in a proxy.
	const proxyPrototype = new Proxy(targetPrototype, {
		has: function (target, key) {
			return key in (ReactComponent.propTypes || {}) || key in targetPrototype;
		},

		// when any undefined property is set, create a getter/setter that re-renders
		set: function (target, key, value, receiver) {
			if (typeof key === 'string' && !(key in proxyPrototype)) {
				// Prepend 'on' and capitalize first char when we have a dom event
				if (key.startsWith('_on')) key = `on${key.charAt(3).toUpperCase()}${key.slice(4)}`;
			}

			const libKey =
				typeof key === 'string' &&
				(key === '__ngContext__' ||
					key.startsWith('__zone_symbol') ||
					key.startsWith('__reactContainer') ||
					key.startsWith('_reactRootContainer'));

			if (rendering) {
				renderAddedProperties[key] = !libKey;
			}

			if (libKey || typeof key === 'symbol' || renderAddedProperties[key] || key in target) {
				return Reflect.set(target, key, value, receiver);
			} else {
				define.expando(receiver, key, value);
			}
			return true;
		},
		// makes sure the property looks writable
		getOwnPropertyDescriptor: function (target, key) {
			const own = Reflect.getOwnPropertyDescriptor(target, key);
			if (own) {
				return own;
			}
			if (key in ReactComponent.propTypes) {
				return { configurable: true, enumerable: true, writable: true, value: undefined };
			}
		},
	});
	WebComponent.prototype = proxyPrototype;

	// Setup lifecycle methods
	targetPrototype.connectedCallback = function () {
		if (this[connectedSymbol] === true) return;
		this[connectedSymbol] = true;

		if (this.childNodes.length) {
			// const dynamicChildElement = wrapDomEleInComponent(Array.from(this.childNodes), React);
			define.expando(this, 'children', this.innerText);
		}

		// Once connected, it will keep updating the innerHTML.
		// We could add a render method to allow this as well.
		this[shouldRenderSymbol] = true;
		this[renderSymbol]();
	};
	targetPrototype[renderSymbol] = function () {
		if (this[shouldRenderSymbol] === true && !rendering) {
			const data = {};
			Object.keys(this).forEach(function (key) {
				if (renderAddedProperties[key] !== false) {
					data[key] = this[key];
				}
			}, this);
			rendering = true;

			// Container is either shadow DOM or light DOM depending on `shadow` option.
			const container = options.shadow ? this.shadowRoot : this;

			// Create and store react component
			this[reactComponentSymbol] = React.createElement(ReactComponent, data);

			// Use react to render element in container
			ReactDOM.render(this[reactComponentSymbol], container);

			rendering = false;
		}
	};

	// Handle attributes changing
	if (ReactComponent.propTypes) {
		WebComponent.observedAttributes = Object.keys(ReactComponent.propTypes);
		targetPrototype.attributeChangedCallback = function (name, oldValue, newValue) {
			// TODO: handle type conversion
			this[name] = newValue;
		};
	}

	return WebComponent;
}
