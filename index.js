import express from "express"
import mongoose from "mongoose"
import cors from "cors"
import bcrypt from "bcrypt"
import session from "express-session"
import passport from "passport"
import jwt from "jsonwebtoken"
import Stripe from "stripe"
import env from "dotenv"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)


//middlewares
const app = express();
app.use(express.json())
app.use(cors())
env.config();

//initialising session
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 1000*60*60*24,
    }
}))
app.use(passport.initialize());
app.use(passport.session());


const port = 5000;
const saltRounds = 10;

mongoose.connect(process.env.MONGO_URI);

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    cart: {
        type: [new mongoose.Schema({
            id: Number,
            title: String,
            description: String,
            category: String,
            image: String,
            price: Number,
            rate: Number
        })],
        default: []
    }
})

const orderSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'users', required: true },
    userEmail: {type: String, required: true}, 
    items: {
        type: [new mongoose.Schema({
            id: Number,
            title: String,
            description: String,
            category: String,
            image: String,
            price: Number,
            rate: Number
        })],
        default: []
    },
    totalAmount: {type: Number, required: true},
    paymentIntentId: { type: String, required: true },
    created: {type: String},
    status: { type: String, default: 'pending' }

})

const userModel = mongoose.model("users", userSchema);
const orderModel = mongoose.model("orders", orderSchema);

app.get("/", (req, res) => {
    res.send("Its started...")
})

app.post("/register", (req, res) => {
    const {name, email, password} = req.body;
    bcrypt.hash(password, saltRounds, async (err, hash) => {
        try {
            const result = {name: name, email: email, password: hash}
            //console.log(result);
            await userModel.create(result)
                    .then(users => {
                        res.json(users)
                    })
                    .catch(err => res.json(err));
        } catch (error) {
            console.log(err);
        }
    })

})

app.post("/login", async (req, res) => {

try {
    const {email, password} = req.body;
    const loginPassword = password;

    await userModel.findOne({email: email})
            .then(user => {
                bcrypt.compare(loginPassword, user.password, (err, result) => {
                    if (err) {
                        console.log("Error comparing passwords: ", err)
                    } else {
                        if (result) {

                            const payload = {
                                username: user.email,
                                id: user._id
                            }

                            const token = jwt.sign(payload, "TOPSECRETWORD", {expiresIn: "1h"})

                            res.json({success: "success", userName: user.name, uid: user._id, token: process.env.JWT_TOKEN_SECRET + token, cart: user.cart});


                        } else {
                            res.json("incorrect password");
                        }
                    }
                })
            })
    } catch(err) {
        console.log(err);
    }

})

// add to cart
app.post(
    "/addtocart", 
    async function isAuthenticated(req, res, next) {
        try {
            const uid = req.body.uid;
            console.log(uid);
            await userModel.findOne({_id: uid})
                    .then(user => {
                        if (user) {
                            console.log("user is here");
                            next();
                        } else {
                            console.log("no user");
                        }
                    })
        } catch (error) {
            console.log("error authenticating user: ", error);
        }
        
    }, 

    async function addingToCart(req, res) {
        try {
            const newItem = {id: req.body.id, title: req.body.title, description: req.body.description, category: req.body.category, image: req.body.image, price: req.body.price, rate: req.body.rate};

            await userModel.updateOne({_id: req.body.uid}, {$push: {cart: [newItem]}});
        } catch (err) {
            console.log("error adding item to cart: ", err);
        }
        
    } 
)

//get cart items
app.post("/getcartitems", async (req, res) => {

    try {
        await userModel.findOne({_id: req.body.uid})
            .then(user => {
                if (user) {
                    res.json({cart: user.cart});
                }
            })
    } catch (err) {
        console.log(err);
    }
    
})

//remove cart item
app.post("/removefromcart", async (req, res) => {
    try {
        // await userModel.updateOne({_id: req.body.uid}, {$pullAll: {cart: {$elemMatch: }}});
        // console.log(req.body.id);

        const user = await userModel.findOne({_id: req.body.uid});
        if (user) {
            const itemIndex = user.cart.findIndex(item => item.id === req.body.id);
            if(itemIndex >= 0) {
                try {
                    user.cart.splice(itemIndex, 1);
                    await user.save();
                } catch(err) {
                    console.log("error saving the cart: ", err)
                }
            } else {
                console.log("item not found");
            }
        } else {
            console.log("user not found");
        }

    } catch (err) {
        console.log("error removing item from cart: ", err);
    }
})

//create payment
app.post("/payment/create", async (req, res) => {
    try {
        const total = req.query.total;
        console.log("Payment request received of >>>>", total);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: total,
            currency: "usd",
        })

        res.status(201).send({clientSecret: paymentIntent.client_secret});

    } catch (error) {
        console.log(error)
    }
})

//create order
app.post("/orderdone", async (req, res) => {
    try {
        const {uid} = req.body;
        let email = "";
        const user = await userModel.findOne({_id: uid})
            if (user) {
                email = user.email;

                async function updateOrders() {
                    const {amount, status, id, uid, cart, created} = req.body;
                    const newOrder = {userId: uid, userEmail: email, items: cart, totalAmount: amount, paymentIntentId: id, created: created, status: status}
                    try {
                        await orderModel.create(newOrder)
                    } catch (error) {
                        console.log(error);
                    } 

                }

                updateOrders();

                user.cart = [];
                await user.save();

            } else {
                console.log("user not found");
            }
        } catch(error) {
            console.log(error);
        }

})

app.get("/orders/:uid", async(req, res) => {
    try {
        const orders = await orderModel.find({userId: req.params.uid});
        res.json(orders);
    } catch (error) {
        console.log(error)
    }
})

app.listen(port, () => {
    console.log(`Listening to port ${port}`)
})